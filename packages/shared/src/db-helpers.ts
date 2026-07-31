// DB-accessing helpers shared by server + client. Take a PrismaClient instance.
import type { PrismaClient } from '../generated/client';
import { computeBalances, sumLedger } from './logic/ledger.js';
import { computeTier } from './logic/tier.js';
import { LEDGER_FIELD, formatDateTime } from './constants.js';

export async function loadBalances(prisma: PrismaClient, memberId: string, now: Date = new Date()) {
  const [ledgers, batches] = await Promise.all([
    prisma.ledger.findMany({ where: { memberId } }),
    prisma.beanBatch.findMany({ where: { memberId } }),
  ]);
  return computeBalances(ledgers as any, batches as any, now);
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
