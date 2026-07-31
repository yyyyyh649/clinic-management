// Local SQLite (full cache) for the Electron front-desk device.
// On first launch: create empty DB file and apply schema.sql, then seed config.
import { app } from 'electron';
import path from 'node:path';
import fs from 'node:fs';
import { fileURLToPath } from 'node:url';
import { PrismaClient, runSeed } from '@clinic/shared';

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

export async function initLocalDb(): Promise<PrismaClient> {
  const userData = app.getPath('userData');
  const dbPath = path.join(userData, 'client.db');
  const isNew = !fs.existsSync(dbPath);
  process.env.DATABASE_URL = `file:${dbPath}`;
  prisma = new PrismaClient({ log: ['error'] });

  if (isNew) {
    await applySchema();
  }

  // Seed config if empty (so the device has stores/staff/tiers/templates/brands offline).
  const storeCount = await prisma.store.count().catch(async (e) => {
    // Table might still be missing if schema apply failed; retry once.
    await applySchema();
    return prisma!.store.count();
  });
  if (storeCount === 0) {
    await runSeed(prisma);
  }
  return prisma;
}
