// Generic sync record applier — used by BOTH server (push handler) and client (pull applier).
// Applies a batch of SyncRecord envelopes to a PrismaClient using append-only or LWW semantics.
import type { PrismaClient } from '../generated/client';
import { APPEND_ONLY, DATE_FIELDS, pkField } from './sync.js';
import type { SyncRecord, SyncTableName } from './types.js';

// Map PascalCase table name -> prisma model delegate key (lowercase first letter).
function modelKey(table: SyncTableName): string {
  return table.charAt(0).toLowerCase() + table.slice(1);
}

function isAppendOnly(table: SyncTableName): boolean {
  return APPEND_ONLY.has(table);
}

// Apply parents before children so FK references exist when dependents land
// (e.g. Payment -> ExamRecord -> Customer, Ledger -> Member).
const TABLE_ORDER: SyncTableName[] = [
  'Store', 'Device', 'Staff', 'TierRule', 'ExamTemplate', 'Brand', 'Setting',
  'Customer', 'PhoneHistory', 'Member',
  'ExamRecord', 'Payment', 'Recharge', 'Ledger', 'BeanBatch',
  'AnomalyRecord', 'RecycleBinEntry', 'AuditLog',
];

// Convert incoming record data: parse date fields, drop null updatedAt fallback.
function prepareData(table: SyncTableName, data: Record<string, unknown>): Record<string, unknown> {
  const out: Record<string, unknown> = { ...data };
  const dateFields = DATE_FIELDS[table] || [];
  for (const f of dateFields) {
    if (out[f] !== null && out[f] !== undefined && out[f] !== '') {
      const v = out[f];
      if (typeof v === 'string') out[f] = new Date(v);
    } else {
      // keep null/undefined as-is (Prisma accepts null for nullable)
      if (out[f] === '') out[f] = null;
    }
  }
  return out;
}

// Fields maintained automatically by the WRITING side (Prisma @updatedAt always
// bumps to local now on any update). Comparing them can never converge across
// two devices, so they must not participate in the no-op check — otherwise a
// pulled-and-reapplied record always looks "changed" and the row ping-pongs
// between devices forever.
const AUTO_FIELDS = new Set(['updatedAt']);

// Detect a true no-op: incoming data is byte-for-byte the same as the existing
// row (every business field matches). This is critical for breaking the sync
// loop on config tables (Store/Staff/Tier/Template/Brand/Setting) that clients
// only ever PULL — without this check, a re-pushed-but-unchanged record would
// hit Prisma .update(), which unconditionally bumps @updatedAt, making the row
// look "fresh" on the next pull and re-triggering a push forever. Skipping the
// write entirely leaves updatedAt untouched and closes the loop.
function dataUnchanged(incoming: Record<string, unknown>, existing: Record<string, unknown>): boolean {
  const keys = Object.keys(incoming);
  for (const k of keys) {
    if (AUTO_FIELDS.has(k)) continue;
    const a = incoming[k];
    const b = existing[k];
    if (a === b) continue;
    if (a instanceof Date && b instanceof Date) {
      if (a.getTime() === b.getTime()) continue;
      return false;
    }
    // Prisma may return Decimal/BigInt wrappers; compare by string value.
    if (a != null && b != null && typeof a !== 'object' && typeof b !== 'object') {
      if (String(a) === String(b)) continue;
      return false;
    }
    // null / undefined equivalence
    if (a == null && b == null) continue;
    return false;
  }
  return true;
}

export interface ApplyResult {
  applied: number;
  skipped: number;
  affectedMemberIds: string[];
}

export async function applySyncRecords(
  prisma: PrismaClient,
  records: SyncRecord[],
): Promise<ApplyResult> {
  let applied = 0, skipped = 0;
  const memberIds = new Set<string>();

  // Group by table and order parent tables first (FK safety within the batch).
  const byTable = new Map<SyncTableName, SyncRecord[]>();
  for (const rec of records) {
    const list = byTable.get(rec.table);
    if (list) list.push(rec);
    else byTable.set(rec.table, [rec]);
  }
  const tables = [...byTable.keys()].sort((a, b) => {
    const ia = TABLE_ORDER.indexOf(a), ib = TABLE_ORDER.indexOf(b);
    return (ia === -1 ? 999 : ia) - (ib === -1 ? 999 : ib);
  });

  const failed: { rec: SyncRecord; error: unknown }[] = [];

  for (const table of tables) {
    const key = modelKey(table) as keyof PrismaClient;
    const delegate = (prisma as any)[key];
    if (!delegate) { skipped += byTable.get(table)!.length; continue; }
    const pk = pkField(table);
    const batch = byTable.get(table)!;

    // One batch read instead of a findUnique per record (was N+1 on big syncs).
    const existing = new Map<string, any>();
    try {
      const rows = await delegate.findMany({ where: { [pk]: { in: batch.map((r) => r.id) } } });
      for (const row of rows) existing.set(String(row[pk]), row);
    } catch { /* fall through: treat all as missing */ }

    for (const rec of batch) {
      const data = prepareData(rec.table, rec.data);
      const id = rec.id;
      try {
        if (isAppendOnly(rec.table)) {
          // create if missing, ignore if exists (never update).
          if (existing.has(id)) { skipped++; continue; }
          await delegate.create({ data });
          existing.set(id, data);
        } else {
          // LWW: only overwrite if incoming newer-or-equal.
          const cur = existing.get(id);
          const incomingUpdated = rec.updatedAt ? new Date(rec.updatedAt) : new Date();
          if (cur) {
            const existingUpdated = cur.updatedAt ? new Date(cur.updatedAt) : new Date(0);
            if (incomingUpdated < existingUpdated) { skipped++; continue; }
            // No-op skip: if the incoming row is identical to what we already have,
            // do NOT call .update(). Prisma's @updatedAt would otherwise bump to
            // "now" on a write that changes nothing, making the row look freshly
            // updated to every other device and feeding the sync loop. Skipping
            // keeps updatedAt stable so the record stops circulating.
            if (dataUnchanged(data, cur)) { skipped++; continue; }
            await delegate.update({ where: { [pk]: id }, data });
          } else {
            await delegate.create({ data });
          }
          existing.set(id, data);
        }
        applied++;
        // track affected members for anomaly recompute
        const mid = (data as any).memberId;
        if (typeof mid === 'string') memberIds.add(mid);
      } catch (e) {
        failed.push({ rec, error: e });
      }
    }
  }

  // One retry pass: a record may have failed because its parent was in a later
  // position of the same batch (ordering above covers table-level deps, but not
  // e.g. self-referencing or cross-table edges we don't know about).
  for (const { rec } of failed) {
    const key = modelKey(rec.table) as keyof PrismaClient;
    const delegate = (prisma as any)[key];
    if (!delegate) continue;
    const pk = pkField(rec.table);
    const data = prepareData(rec.table, rec.data);
    try {
      const cur = await delegate.findUnique({ where: { [pk]: rec.id } }).catch(() => null);
      if (isAppendOnly(rec.table)) {
        if (cur) { skipped++; continue; }
        await delegate.create({ data });
      } else {
        const incomingUpdated = rec.updatedAt ? new Date(rec.updatedAt) : new Date();
        if (cur) {
          const existingUpdated = cur.updatedAt ? new Date(cur.updatedAt) : new Date(0);
          if (incomingUpdated < existingUpdated) { skipped++; continue; }
          if (dataUnchanged(data, cur)) { skipped++; continue; }
          await delegate.update({ where: { [pk]: rec.id }, data });
        } else {
          await delegate.create({ data });
        }
      }
      applied++;
      const mid = (data as any).memberId;
      if (typeof mid === 'string') memberIds.add(mid);
    } catch (e) {
      // Genuine failure (bad shape, missing parent that never arrived). Log it —
      // silent skips here are how the two databases silently diverge.
      skipped++;
      console.warn(`[sync] drop record ${rec.table}/${rec.id}: ${(e as any)?.message || e}`);
    }
  }

  return { applied, skipped, affectedMemberIds: [...memberIds] };
}
