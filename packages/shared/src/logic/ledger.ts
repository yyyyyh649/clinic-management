// Ledger accounting: current values are the SUM of append-only deltas, never stored.
import type { Ledger, BeanBatch } from '../../generated/client';
import { LEDGER_FIELD } from '../constants.js';
import type { BalanceSummary } from '../types.js';

// Sum all deltas by field for a member's ledger entries.
export function sumLedger(ledgers: Ledger[]): { balanceCents: number; beans: number; points: number } {
  let balanceCents = 0, beans = 0, points = 0;
  for (const l of ledgers) {
    switch (l.field) {
      case LEDGER_FIELD.BALANCE: balanceCents += l.delta; break;
      case LEDGER_FIELD.BEANS:   beans += l.delta; break;
      case LEDGER_FIELD.POINTS:  points += l.delta; break;
    }
  }
  return { balanceCents, beans, points };
}

// Spendable beans = sum of remaining across non-expired, non-empty batches.
// A batch is "expired" if expired flag set OR expiresAt < now.
export function spendableBeans(batches: BeanBatch[], now: Date = new Date()): number {
  let total = 0;
  for (const b of batches) {
    if (b.expired) continue;
    if (b.remaining <= 0) continue;
    if (b.expiresAt && new Date(b.expiresAt) < now) continue;
    total += b.remaining;
  }
  return total;
}

// Recompute each batch's TRUE remaining from the append-only Ledger.
// BeanBatch.remaining is a mutable counter decremented on consume; under
// offline multi-device LWW sync merge it can be overstated (two devices each
// decrement from 200->100, the later one wins -> server stays at 100 instead
// of 0). The Ledger (append-only, dedup by id) is the authoritative source,
// so we rebuild remaining = total - sum(consume deltas for this batchId).
// This makes spendableBeans / selectFIFOConsume correct even when the stored
// remaining drifted from LWW merge.
export function recomputeBatchesFromLedger(batches: BeanBatch[], ledgers: Ledger[]): BeanBatch[] {
  const consumedByBatch = new Map<string, number>();
  for (const l of ledgers) {
    if (l.beanBatchId && l.field === LEDGER_FIELD.BEANS && l.delta < 0) {
      consumedByBatch.set(l.beanBatchId, (consumedByBatch.get(l.beanBatchId) || 0) + l.delta);
    }
  }
  return batches.map((b) => {
    const consumed = consumedByBatch.get(b.id) || 0;
    const realRemaining = Math.max(0, b.total + consumed); // total is the original award, consumed is negative
    return { ...b, remaining: realRemaining };
  });
}

export function computeBalances(ledgers: Ledger[], batches: BeanBatch[], now: Date = new Date()): BalanceSummary {
  const sums = sumLedger(ledgers);
  // Rebuild batch.remaining from the authoritative Ledger so that LWW merge
  // drift on the stored counter can never inflate spendable beans.
  const reconciledBatches = recomputeBatchesFromLedger(batches, ledgers);
  return {
    balanceCents: sums.balanceCents,
    beans: sums.beans,
    points: sums.points,
    spendableBeans: spendableBeans(reconciledBatches, now),
  };
}

// Detect negative balance / beans (post-merge anomaly).
export function detectAnomalies(ledgers: Ledger[]): { field: 'BALANCE' | 'BEANS'; value: number }[] {
  const sums = sumLedger(ledgers);
  const out: { field: 'BALANCE' | 'BEANS'; value: number }[] = [];
  if (sums.balanceCents < 0) out.push({ field: 'BALANCE', value: sums.balanceCents });
  if (sums.beans < 0) out.push({ field: 'BEANS', value: sums.beans });
  return out;
}
