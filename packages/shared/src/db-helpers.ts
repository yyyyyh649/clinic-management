// DB-accessing helpers shared by server + client. Take a PrismaClient instance.
import type { PrismaClient } from '../generated/client';
import { computeBalances, sumLedger, recomputeBatchesFromLedger } from './logic/ledger.js';
import { dueForExpiry } from './logic/beans.js';
import { computeTier } from './logic/tier.js';
import { LEDGER_FIELD, LEDGER_SOURCE, formatDateTime } from './constants.js';

export async function loadBalances(prisma: PrismaClient, memberId: string, now: Date = new Date()) {
  const [ledgers, batches] = await Promise.all([
    prisma.ledger.findMany({ where: { memberId } }),
    prisma.beanBatch.findMany({ where: { memberId } }),
  ]);
  return computeBalances(ledgers as any, batches as any, now);
}

// Bean expiry sweep: find batches past their expiry date with remaining > 0
// and not yet flagged, then for each:
//   1. create an EXPIRE Ledger row (delta = -remaining) so the append-only
//      ledger reflects the write-down and 累计豆 converges with 可花豆,
//   2. set BeanBatch.expired = true so it stops being selected by FIFO/spendable.
//
// The Ledger id is derived deterministically from the batch id
// (`bean-expire-<batchId>`) so the append-only dedup (INSERT OR IGNORE by id)
// makes this idempotent: running it on both server and client, or re-running
// on boot, never creates duplicate EXPIRE ledgers.
//
// Call sites: server initDb() on boot, client initLocalDb() on boot. The
// beanExpiry *setting* is not needed here — expiry is per-batch (expiresAt
// already stamped at award time), so a disabled global setting simply means
// no batch has an expiresAt and dueForExpiry returns empty.
export async function expireDueBeanBatches(prisma: PrismaClient, now: Date = new Date(), origin: 'SERVER' | 'CLIENT' = 'SERVER'): Promise<number> {
  const batches = await prisma.beanBatch.findMany({ where: { expired: false } });
  if (batches.length === 0) return 0;
  // Rebuild remaining from the append-only Ledger BEFORE checking expiry, so a
  // batch whose stored remaining was inflated by LWW sync merge doesn't get
  // over-written-down at expiry (would make 累计豆 lower than reality). The
  // Ledger is authoritative; using the stored counter here was the leftover gap.
  const allBeanLedgers = await prisma.ledger.findMany({ where: { field: LEDGER_FIELD.BEANS } });
  const reconciled = recomputeBatchesFromLedger(batches as any, allBeanLedgers as any);
  const due = dueForExpiry(reconciled, now);
  if (due.length === 0) return 0;

  let expiredCount = 0;
  for (const b of due) {
    const ledgerId = `bean-expire-${b.id}`;
    // Idempotent: skip if the EXPIRE ledger already exists.
    const exists = await prisma.ledger.findUnique({ where: { id: ledgerId } }).catch(() => null);
    if (exists) {
      // Ledger already written but batch flag not set (partial prior run) — just flag it.
      await prisma.beanBatch.update({ where: { id: b.id }, data: { expired: true } }).catch(() => {});
      expiredCount++;
      continue;
    }
    try {
      await prisma.$transaction(async (tx) => {
        await tx.ledger.create({
          data: {
            id: ledgerId,
            memberId: b.memberId,
            field: LEDGER_FIELD.BEANS,
            delta: -b.remaining,
            source: LEDGER_SOURCE.EXPIRE,
            reason: `豆到期核销（批次 ${b.id}，剩余 ${b.remaining} 豆）`,
            refType: 'EXPIRE',
            refId: b.id,
            beanBatchId: b.id,
            operatorId: 'SYSTEM',
            operatorName: '系统核销',
            storeId: '',
            storeName: '',
            deviceId: '',
            syncStatus: 'PENDING',
            origin,
          },
        });
        await tx.beanBatch.update({ where: { id: b.id }, data: { expired: true } });
      });
      expiredCount++;
    } catch {
      // race / constraint — skip; next run will retry.
    }
  }
  return expiredCount;
}

export async function loadMemberDetail(prisma: PrismaClient, memberId: string) {
  const member = await prisma.member.findUnique({
    where: { id: memberId },
    include: {
      customer: true,
      ledgers: { orderBy: { createdAt: 'desc' }, take: 500 },
      beanBatches: { orderBy: { createdAt: 'desc' } },
    },
  });
  if (!member) return null;
  const [tiers, balances] = await Promise.all([
    prisma.tierRule.findMany({ orderBy: { minPoints: 'asc' } }),
    loadBalances(prisma, memberId),
  ]);
  const tier = computeTier(balances.points, tiers as any);
  // exams for the underlying customer (cross-store, since关联 customer_id).
  // B.6: voided unpaid drafts are not real business — exclude them.
  const exams = await prisma.examRecord.findMany({
    where: { customerId: member.customerId, deletedAt: null, voidedAt: null },
    orderBy: { registeredAt: 'desc' },
  });
  // 代付 records: payments where this member's balance/beans were used
  const usagePayments = await prisma.payment.findMany({
    where: { payForMemberId: memberId },
    orderBy: { createdAt: 'desc' },
  });
  return {
    member,
    customer: member.customer,
    balances,
    tier,
    exams,
    usagePayments,
    ledgers: member.ledgers,
    beanBatches: member.beanBatches,
  };
}

// Compute age from birthday (real-time, no snapshot).
export function computeAge(birthday: Date | string | null | undefined): number | null {
  if (!birthday) return null;
  const b = typeof birthday === 'string' ? new Date(birthday) : birthday;
  if (Number.isNaN(b.getTime())) return null;
  const now = new Date();
  let age = now.getFullYear() - b.getFullYear();
  const m = now.getMonth() - b.getMonth();
  if (m < 0 || (m === 0 && now.getDate() < b.getDate())) age--;
  return age >= 0 ? age : 0;
}

// Days until/since a review date.
export function reviewDaysRemaining(reviewDate: Date | string | null | undefined, now: Date = new Date()): number | null {
  if (!reviewDate) return null;
  const d = typeof reviewDate === 'string' ? new Date(reviewDate) : reviewDate;
  if (Number.isNaN(d.getTime())) return null;
  const diff = Math.ceil((d.getTime() - now.getTime()) / (1000 * 60 * 60 * 24));
  return diff;
}

// Member is "待复查": has a review with status PENDING/CONTACTED and reviewDate <= now+grace.
export function isPendingReview(review: { reviewStatus: string; reviewDate: Date | string }, now: Date = new Date()): boolean {
  if (review.reviewStatus === 'REVIEWED' || review.reviewStatus === 'CONTACTED_NO_SHOW') return false;
  const days = reviewDaysRemaining(review.reviewDate, now);
  return days !== null && days <= 7; // due or upcoming within 7 days => 待复查
}

// Member "成为会员天数".
export function memberDaysSince(registeredAt: Date | string, now: Date = new Date()): number {
  const d = typeof registeredAt === 'string' ? new Date(registeredAt) : registeredAt;
  return Math.max(0, Math.floor((now.getTime() - d.getTime()) / (1000 * 60 * 60 * 24)));
}

export { formatDateTime };
