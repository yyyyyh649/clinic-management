// Bean batch FIFO consumption + expiry scheduling.
import type { BeanBatch } from '../generated/client/index.js';

export interface BeanExpirySetting {
  enabled: boolean;
  months: number | null; // null when disabled => never expires
}

// Compute the expiry date for a bean award batch (non-retroactive for existing batches).
export function computeBatchExpiry(awardedAt: Date, setting: BeanExpirySetting): Date | null {
  if (!setting.enabled || !setting.months) return null;
  const d = new Date(awardedAt);
  d.setMonth(d.getMonth() + setting.months);
  return d;
}

// Batches that are due for expiry (past expiry date, still have remaining, not yet flagged).
export function dueForExpiry(batches: BeanBatch[], now: Date = new Date()): BeanBatch[] {
  return batches.filter((b) => !b.expired && b.remaining > 0 && b.expiresAt && new Date(b.expiresAt) <= now);
}

// FIFO selection: consume `amount` beans from the earliest-expiring non-expired batches.
// Returns a list of { batchId, consume } that sum to min(amount, available).
// Ordering: batches with an expiry date ascending; batches with no expiry last.
export interface FIFOConsumePlan {
  batchId: string;
  consume: number;
}
export function selectFIFOConsume(batches: BeanBatch[], amount: number, now: Date = new Date()): FIFOConsumePlan[] {
  if (amount <= 0) return [];
  const available = batches.filter((b) => !b.expired && b.remaining > 0 && (!b.expiresAt || new Date(b.expiresAt) > now));
  // sort: earliest expiry first; null expiry last.
  available.sort((a, b) => {
    const ae = a.expiresAt ? new Date(a.expiresAt).getTime() : Infinity;
    const be = b.expiresAt ? new Date(b.expiresAt).getTime() : Infinity;
    return ae - be;
  });
  const plan: FIFOConsumePlan[] = [];
  let remaining = amount;
  for (const b of available) {
    if (remaining <= 0) break;
    const take = Math.min(remaining, b.remaining);
    plan.push({ batchId: b.id, consume: take });
    remaining -= take;
  }
  return plan;
}

export function totalSpendable(batches: BeanBatch[], now: Date = new Date()): number {
  return selectFIFOConsume(batches, Number.MAX_SAFE_INTEGER, now).reduce((s, p) => s + p.consume, 0);
}
