// Anomaly recompute: after a sync merge, scan all members and flag any whose
// balance or beans went negative (断网期间多端透支). Do NOT silently fix — surface for人工复核.
import { prisma } from './db.js';
import { detectAnomalies } from '@clinic/shared';
import type { Prisma } from '@clinic/shared';

// Recompute anomalies for a set of member ids (or all if none passed).
export async function recomputeAnomalies(memberIds?: string[]) {
  const where: Prisma.MemberWhereInput = memberIds && memberIds.length ? { id: { in: memberIds } } : {};
  const members = await prisma.member.findMany({
    where,
    include: { ledgers: { where: { syncStatus: 'SYNCED' } }, customer: true },
  });

  const newAnomalies: { memberId: string; field: string; value: number; conflictLedgerIds: string[] }[] = [];
  const stillNegativeMembers = new Set<string>();

  for (const m of members) {
    const anomalies = detectAnomalies(m.ledgers as any);
    if (anomalies.length === 0) continue;
    stillNegativeMembers.add(m.id);
    // Gather recent conflict ledgers (this member) for the detail.
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

  // Upsert anomaly records (one per member+field, OPEN). Resolve if no longer negative.
  const existing = await prisma.anomalyRecord.findMany({
    where: memberIds && memberIds.length ? { memberId: { in: memberIds } } : { status: 'OPEN' },
  });

  for (const a of newAnomalies) {
    const m = members.find((x) => x.id === a.memberId)!;
    const existingRec = existing.find((e) => e.memberId === a.memberId && e.field === a.field && e.status === 'OPEN');
    const detail = `会员 ${m.customer?.name ?? ''} (卡号 ${m.cardNo}) 的${
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
