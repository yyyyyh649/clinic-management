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

  for (const rec of records) {
    const key = modelKey(rec.table) as keyof PrismaClient;
    const delegate = (prisma as any)[key];
    if (!delegate) { skipped++; continue; }
    const data = prepareData(rec.table, rec.data);
    const id = rec.id;
    // Look up / dedup by the table's actual primary key (Setting uses `key`,
    // everything else uses `id`). Hardcoding `id` broke Setting sync silently.
    const pk = pkField(rec.table);

    try {
      if (isAppendOnly(rec.table)) {
        // create if missing, ignore if exists (never update).
        const existing = await delegate.findUnique({ where: { [pk]: id } }).catch(() => null);
        if (existing) { skipped++; continue; }
        await delegate.create({ data });
        applied++;
      } else {
        // LWW: only overwrite if incoming newer-or-equal.
        const existing = await delegate.findUnique({ where: { [pk]: id } }).catch(() => null);
        const incomingUpdated = rec.updatedAt ? new Date(rec.updatedAt) : new Date();
        if (existing) {
          const existingUpdated = existing.updatedAt ? new Date(existing.updatedAt) : new Date(0);
          if (incomingUpdated < existingUpdated) { skipped++; continue; }
          // No-op skip: if the incoming row is identical to what we already have,
          // do NOT call .update(). Prisma's @updatedAt would otherwise bump to
          // "now" on a write that changes nothing, making the row look freshly
          // updated to every other device and feeding the sync loop. Skipping
          // keeps updatedAt stable so the record stops circulating.
          if (dataUnchanged(data, existing)) { skipped++; continue; }
          await delegate.update({ where: { [pk]: id }, data });
        } else {
          await delegate.create({ data });
        }
        applied++;
      }
      // track affected members for anomaly recompute
      const mid = (data as any).memberId;
      if (typeof mid === 'string') memberIds.add(mid);
    } catch (e) {
      // unique constraint / shape mismatch => skip rather than abort whole batch
      skipped++;
    }
  }

  return { applied, skipped, affectedMemberIds: [...memberIds] };
}
