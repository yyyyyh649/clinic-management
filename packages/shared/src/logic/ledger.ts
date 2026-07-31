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

export function computeBalances(ledgers: Ledger[], batches: BeanBatch[], now: Date = new Date()): BalanceSummary {
  const sums = sumLedger(ledgers);
  return {
    balanceCents: sums.balanceCents,
    beans: sums.beans,
    points: sums.points,
    spendableBeans: spendableBeans(batches, now),
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
