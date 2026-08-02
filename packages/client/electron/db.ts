// Local SQLite (full cache) for the Electron front-desk device.
// On first launch: create empty DB file and apply schema.sql, then seed config.
import { app } from 'electron';
import path from 'node:path';
import fs from 'node:fs';
import { fileURLToPath } from 'node:url';
import { PrismaClient, runSeed, expireDueBeanBatches } from '@clinic/shared';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

let prisma: PrismaClient | null = null;

export function getPrisma(): PrismaClient {
  if (!prisma) throw new Error('local db not initialized');
  return prisma;
}

// Apply schema.sql (CREATE TABLE IF NOT EXISTS style is safer; here we create-if-missing).
async function applySchema() {
  if (!prisma) throw new Error('prisma not initialized');
  const schemaPath = app.isPackaged
    ? path.join(process.resourcesPath, 'schema.sql')
    : path.join(__dirname, '../electron/schema.sql');
  const sql = fs.readFileSync(schemaPath, 'utf-8');
  // Split on semicolons at end of statements, execute each non-empty.
  // SQLite via Prisma: use $executeRawUnsafe for DDL (no params here).
  const stmts = sql.split(/;\s*\n/).map((s) => s.trim()).filter(Boolean);
  for (const stmt of stmts) {
    try { await prisma!.$executeRawUnsafe(stmt); } catch (e) { /* already exists */ }
  }
}

// Migrate existing DB: add columns that were introduced after initial release.
// SQLite's ALTER TABLE ADD COLUMN is idempotent-safe via try/catch (errors if column exists).
// Each migration is a single ADD COLUMN; wrap individually so one failure doesn't block others.
async function runMigrations() {
  if (!prisma) throw new Error('prisma not initialized');
  const migrations: string[] = [
    // voidedAt added to ExamRecord for B.6 (void unpaid drafts)
    'ALTER TABLE "ExamRecord" ADD COLUMN "voidedAt" DATETIME',
    // discardedAt + revisesExamId added for §2.2 版本化编辑检查单
    // (commit a0de7a5 added fields to schema.prisma but missed these ALTER TABLE
    // migrations, breaking offline register/edit on devices with old DBs).
    'ALTER TABLE "ExamRecord" ADD COLUMN "discardedAt" DATETIME',
    'ALTER TABLE "ExamRecord" ADD COLUMN "revisesExamId" TEXT',
  ];
  for (const sql of migrations) {
    try { await prisma!.$executeRawUnsafe(sql); } catch { /* column already exists */ }
  }
  // Indexes for common query patterns (commit a0de7a5 added these to schema.prisma
  // @@index but schema.sql / runMigrations didn't create them on existing DBs).
  const indexes: string[] = [
    'CREATE INDEX IF NOT EXISTS "ExamRecord_revisesExamId_idx" ON "ExamRecord"("revisesExamId")',
    'CREATE INDEX IF NOT EXISTS "ExamRecord_registeredBy_idx" ON "ExamRecord"("registeredBy")',
    'CREATE INDEX IF NOT EXISTS "Member_registeredAt_idx" ON "Member"("registeredAt")',
    'CREATE INDEX IF NOT EXISTS "Member_registeredStoreId_idx" ON "Member"("registeredStoreId")',
    'CREATE INDEX IF NOT EXISTS "Customer_createdAt_idx" ON "Customer"("createdAt")',
  ];
  for (const sql of indexes) {
    try { await prisma!.$executeRawUnsafe(sql); } catch { /* index already exists */ }
  }
}

export async function initLocalDb(): Promise<PrismaClient> {
  const userData = app.getPath('userData');
  const dbPath = path.join(userData, 'client.db');
  const isNew = !fs.existsSync(dbPath);
  process.env.DATABASE_URL = `file:${dbPath}`;
  prisma = new PrismaClient({ log: ['error'] });

  if (isNew) {
    await applySchema();
  }
  // Always run migrations: harmless on new DBs (columns already exist),
  // and adds missing columns on existing DBs from older app versions.
  await runMigrations();

  // Seed config if empty (so the device has stores/staff/tiers/templates/brands offline).
  const storeCount = await prisma.store.count().catch(async (e) => {
    // Table might still be missing if schema apply failed; retry once.
    await applySchema();
    return prisma!.store.count();
  });
  if (storeCount === 0) {
    await runSeed(prisma);
  }
  // Bean expiry sweep (idempotent):核销已过期批次，写 EXPIRE ledger + 置 expired。
  // 与服务器启动一致；ledger id 派生自 batchId，append-only 去重，两端都跑不会重复。
  await expireDueBeanBatches(prisma, new Date(), 'CLIENT').catch(() => {});
  return prisma;
}
