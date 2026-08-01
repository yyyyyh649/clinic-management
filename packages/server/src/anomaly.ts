// Anomaly recompute: after a sync merge, scan all members and flag any whose
// balance or beans went negative (断网期间多端透支), AND flag any whose stored
// BeanBatch.remaining drifted above the Ledger-derived true remaining (LWW merge
// can lose concurrent decrements, inflating the stored counter). Do NOT silently
// fix — surface for人工复核.
import { prisma } from './db.js';
import { detectAnomalies, recomputeBatchesFromLedger, spendableBeans } from '@clinic/shared';
import type { Prisma } from '@clinic/shared';

// Recompute anomalies for a set of member ids (or all if none passed).
export async function recomputeAnomalies(memberIds?: string[]) {
  const where: Prisma.MemberWhereInput = memberIds && memberIds.length ? { id: { in: memberIds } } : {};
  const members = await prisma.member.findMany({
    where,
    include: {
      ledgers: { where: { syncStatus: 'SYNCED' } },
      beanBatches: true,
      customer: true,
    },
  });

  const newAnomalies: { memberId: string; field: string; value: number; conflictLedgerIds: string[]; detail?: string }[] = [];
  const stillNegativeMembers = new Set<string>();

  for (const m of members) {
    // 1. negative balance / beans (透支)
    const anomalies = detectAnomalies(m.ledgers as any);
    if (anomalies.length > 0) {
      stillNegativeMembers.add(m.id);
      const conflict = m.ledgers
        .filter((l) => anomalies.some((a) => a.field === l.field))
        .sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime())
        .slice(0, 20);
      for (const a of anomalies) {
        newAnomalies.push({
          memberId: m.id,
          field: a.field,
          value: a.value,
          conflictLedgerIds: conflict.map((l) => l.id),
        });
      }
    }

    // 2. BeanBatch stored remaining vs Ledger-reconciled remaining drift.
    // LWW merge on BeanBatch can lose concurrent decrements (two devices each
    // 200->100, later wins -> server stays 100 instead of 0). spendableBeans
    // now rebuilds from Ledger so business logic is correct, but the stored
    // counter being wrong is itself a data-integrity signal — surface it.
    if (m.beanBatches && m.beanBatches.length > 0) {
      const storedSpendable = spendableBeans(m.beanBatches as any);
      const reconciled = recomputeBatchesFromLedger(m.beanBatches as any, m.ledgers as any);
      const trueSpendable = spendableBeans(reconciled);
      if (storedSpendable > trueSpendable) {
        stillNegativeMembers.add(m.id);
        newAnomalies.push({
          memberId: m.id,
          field: 'BEANS_DRIFT',
          value: storedSpendable - trueSpendable,
          conflictLedgerIds: m.ledgers
            .filter((l) => l.field === 'BEANS' && l.delta < 0)
            .sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime())
            .slice(0, 20)
            .map((l) => l.id),
          detail: `会员 ${m.customer?.name ?? ''} (卡号 ${m.cardNo}) 的豆批次存储余量(${storedSpendable})高于 Ledger 真实余量(${trueSpendable})，疑似断网合并丢失扣减，已偏移 ${storedSpendable - trueSpendable} 豆。业务按真实值计算不受影响，请人工复核。`,
        });
      }
    }
  }

  // Upsert anomaly records (one per member+field, OPEN). Resolve if no longer negative.
  const existing = await prisma.anomalyRecord.findMany({
    where: memberIds && memberIds.length ? { memberId: { in: memberIds } } : { status: 'OPEN' },
  });

  for (const a of newAnomalies) {
    const m = members.find((x) => x.id === a.memberId)!;
    const existingRec = existing.find((e) => e.memberId === a.memberId && e.field === a.field && e.status === 'OPEN');
    // BEANS_DRIFT carries its own detail (stored vs true remaining); others use the透支 template.
    const detail = a.detail ?? `会员 ${m.customer?.name ?? ''} (卡号 ${m.cardNo}) 的${
      a.field === 'BALANCE' ? '卡内余额' : '豆'
    }合并后为 ${a.value}（${a.field === 'BALANCE' ? '分' : '个'}），疑似断网期间多端透支，请人工电话核实。`;
    if (existingRec) {
      await prisma.anomalyRecord.update({
        where: { id: existingRec.id },
        data: { currentValue: a.value, conflictLedgerIds: JSON.stringify(a.conflictLedgerIds), detail },
      });
    } else {
      await prisma.anomalyRecord.create({
        data: {
          memberId: a.memberId,
          memberName: m.customer?.name ?? '',
          memberCardNo: m.cardNo,
          field: a.field,
          currentValue: a.value,
          conflictLedgerIds: JSON.stringify(a.conflictLedgerIds),
          detail,
          storeId: m.registeredStoreId,
        },
      });
    }
  }

  // Auto-resolve anomalies whose member is no longer negative.
  for (const e of existing) {
    if (e.status !== 'OPEN') continue;
    if (!stillNegativeMembers.has(e.memberId)) {
      await prisma.anomalyRecord.update({
        where: { id: e.id },
        data: { status: 'RESOLVED', resolvedAt: new Date(), resolvedByName: '系统自动', resolveNote: '余额已恢复非负，自动解除异常。' },
      });
    }
  }

  return newAnomalies;
}
