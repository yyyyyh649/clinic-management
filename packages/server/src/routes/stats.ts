// Stats + admin operations: revenue, performance, member/exam counts, anomaly, recycle, audit, export.
import { Router } from 'express';
import { prisma } from '../db.js';
import {
  computeRevenue, computeRevenueSeries, aggregatePerformance, commissionForMerged,
  formatCents, formatDate, formatDateTime, RECYCLE_RETENTION_DAYS,
} from '@clinic/shared';
import type { RechargeForRevenue, PaymentForRevenue, BalanceAdjustForRevenue } from '@clinic/shared';

export const statsRouter = Router();

// ---------- Revenue (§6.2): cash / stored-consume / allocated / total, with rolling结转 ----------
statsRouter.get('/revenue', async (req, res) => {
  const year = Number(req.query.year) || new Date().getFullYear();
  const month = req.query.month ? Number(req.query.month) : new Date().getMonth() + 1;
  const storeId = req.query.storeId as string | undefined;

  const rechargeWhere: any = {};
  if (storeId) rechargeWhere.storeId = storeId;
  const recharges = await prisma.recharge.findMany({ where: rechargeWhere });
  const rechargeForRev: RechargeForRevenue[] = recharges.map((r) => ({ cashPaid: r.cashPaid, balanceAdded: r.balanceAdded, createdAt: r.createdAt }));

  const paymentWhere: any = {};
  if (storeId) paymentWhere.storeId = storeId;
  const payments = await prisma.payment.findMany({ where: paymentWhere, include: { exam: true } });
  const paymentForRev: PaymentForRevenue[] = payments.map((p) => ({
    dept: p.exam.dept as 'OPTICAL' | 'EYE', cashPaid: p.cashPaid, balanceDeduct: p.balanceDeduct, beansDeductAmount: p.beansDeductAmount, createdAt: p.createdAt,
  }));

  // Manual balance adjustments via Ledger (source=ADJUST, field=BALANCE, positive delta only).
  // These increase the stored pool even when no Recharge row exists (e.g. 直接赠送).
  const ledgerWhere: any = { field: 'BALANCE', source: 'ADJUST', delta: { gt: 0 } };
  if (storeId) ledgerWhere.storeId = storeId;
  const balanceLedgers = await prisma.ledger.findMany({ where: ledgerWhere });
  const balanceAdjusts: BalanceAdjustForRevenue[] = balanceLedgers.map((l) => ({ delta: l.delta, createdAt: l.createdAt }));

  const monthRow = computeRevenue(rechargeForRev, paymentForRev, year, month, balanceAdjusts);
  const series = computeRevenueSeries(rechargeForRev, paymentForRev, year, balanceAdjusts);
  res.json({ month: monthRow, series });
});

// ---------- Funds pool (现金池/储值池) management: monthly breakdown + per-record detail ----------
statsRouter.get('/funds', async (req, res) => {
  const year = Number(req.query.year) || new Date().getFullYear();
  const storeId = req.query.storeId as string | undefined;

  const rechargeWhere: any = {};
  if (storeId) rechargeWhere.storeId = storeId;
  const recharges = await prisma.recharge.findMany({ where: rechargeWhere, orderBy: { createdAt: 'desc' } });

  const ledgerWhere: any = { field: 'BALANCE', source: 'ADJUST', delta: { gt: 0 } };
  if (storeId) ledgerWhere.storeId = storeId;
  const balanceAdjusts = await prisma.ledger.findMany({ where: ledgerWhere, orderBy: { createdAt: 'desc' } });

  // 手动调整明细原来只带 memberId，没有 cardNo，前端就显示成了UUID。这里补一次映射。
  const memberIds = [...new Set(balanceAdjusts.map((l) => l.memberId))];
  const members = memberIds.length
    ? await prisma.member.findMany({ where: { id: { in: memberIds } }, select: { id: true, cardNo: true } })
    : [];
  const cardNoByMemberId = new Map(members.map((m) => [m.id, m.cardNo]));

  // 「充值+手动调整余额」在写入时被拆成 Recharge(现金,balanceAdded恒为0) + Ledger(储值,refType='ADJUST_WITH_RECHARGE')
  // 两条记录，用 ledger.refId === recharge.id 把它们配对，展示时合并成一行。
  const rechargeById = new Map(recharges.map((r) => [r.id, r]));
  const ledgerByRechargeId = new Map(
    balanceAdjusts
      .filter((l) => l.refType === 'ADJUST_WITH_RECHARGE' && l.refId && rechargeById.has(l.refId))
      .map((l) => [l.refId as string, l])
  );

  const months: Record<string, { newCash: number; newStored: number; details: any[] }> = {};
  for (let m = 1; m <= 12; m++) {
    months[`${year}-${m}`] = { newCash: 0, newStored: 0, details: [] };
  }

  for (const r of recharges) {
    const d = new Date(r.createdAt);
    if (d.getFullYear() !== year) continue;
    const key = `${year}-${d.getMonth() + 1}`;
    const linkedLedger = ledgerByRechargeId.get(r.id);
    // 总量口径不变：原来是 r.balanceAdded(通常为0) 和 linkedLedger.delta 分别求和，
    // 现在合并成一次求和，数值上完全等价，不会多算。
    const storedAmount = r.balanceAdded + (linkedLedger ? linkedLedger.delta : 0);
    months[key].newCash += r.cashPaid;
    months[key].newStored += storedAmount;
    months[key].details.push({
      type: 'RECHARGE', id: r.id, createdAt: r.createdAt,
      cardNo: r.cardNo, cashPaid: r.cashPaid, balanceAdded: storedAmount,
      beansGifted: r.beansGifted, operatorName: r.operatorName, storeName: r.storeName,
      note: linkedLedger ? linkedLedger.reason : r.note,
    });
  }
  for (const l of balanceAdjusts) {
    // 已经在上面合并进对应的 recharge 行了，这里跳过，避免重复展示和重复计入。
    if (l.refType === 'ADJUST_WITH_RECHARGE' && l.refId && rechargeById.has(l.refId)) continue;
    const d = new Date(l.createdAt);
    if (d.getFullYear() !== year) continue;
    const key = `${year}-${d.getMonth() + 1}`;
    months[key].newStored += l.delta;
    months[key].details.push({
      type: 'ADJUST', id: l.id, createdAt: l.createdAt,
      memberId: l.memberId, cardNo: cardNoByMemberId.get(l.memberId) || '',
      delta: l.delta, reason: l.reason,
      operatorName: l.operatorName, storeName: l.storeName,
    });
  }

  const items = Object.entries(months).map(([k, v]) => ({
    month: k,
    newCash: v.newCash,
    newStored: v.newStored,
    total: v.newCash + v.newStored,
    details: v.details.sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime()),
  }));

  const totalCash = items.reduce((s, m) => s + m.newCash, 0);
  const totalStored = items.reduce((s, m) => s + m.newStored, 0);
  res.json({ year, items, totalCash, totalStored, total: totalCash + totalStored });
});

// ---------- Staff performance (§6.4): optical consume, merged tiered commission, open count, brand ----------
// B.1: every active staff whose depts include 配镜部 must appear (0 if no business),
//      instead of only those who happened to close an optical payment this month.
// B.2/E: performance & brand incentives are attributed to the EXAM's registrar
//      (exam.registeredBy), not payment.operatorId. Since E makes the payment
//      operator always equal to the registrar, they coincide in practice — but
//      we still key off the exam so the source of truth is "who did this 配镜 job".
statsRouter.get('/performance', async (req, res) => {
  const year = Number(req.query.year) || new Date().getFullYear();
  const month = req.query.month ? Number(req.query.month) : new Date().getMonth() + 1;
  const storeId = req.query.storeId as string | undefined;

  const monthStart = new Date(year, month - 1, 1);
  const monthEnd = new Date(year, month, 1);

  // 1. Active staff with 配镜部 in depts (B.1: include everyone, even 0 业绩).
  const allStaff = await prisma.staff.findMany({ where: { active: true, deletedAt: null } });
  const opticalStaff = allStaff.filter((s) => (s.depts || '').split(',').map((d) => d.trim()).includes('OPTICAL'));
  const staffById = new Map(opticalStaff.map((s) => [s.id, s]));

  // 2. 配镜部 exams in month (with payments) — keyed by exam.registeredBy (B.2/E).
  // §2.5: exclude discarded revisions so a revised exam isn't counted twice.
  const examWhere: any = { dept: 'OPTICAL', registeredAt: { gte: monthStart, lt: monthEnd }, deletedAt: null, voidedAt: null, discardedAt: null };
  if (storeId) examWhere.registeredStoreId = storeId;
  const exams = await prisma.examRecord.findMany({ where: examWhere, include: { payment: true } });

  // 业绩 = 实际余额消耗值 (balanceDeduct + beansDeductAmount) of paid optical exams.
  const rawRows: { staffId: string; staffName: string; storeId: string; storeName: string; consumeCents: number }[] = [];
  const brandByStaff = new Map<string, { lens: Record<string, number>; frame: Record<string, number> }>();
  for (const e of exams) {
    const s = staffById.get(e.registeredBy);
    const staffName = e.registeredByName || s?.name || '';
    const sid = e.registeredBy;
    // brand incentives keyed by registrar (B.2) — count every optical exam, paid or not.
    let b = brandByStaff.get(sid);
    if (!b) { b = { lens: {}, frame: {} }; brandByStaff.set(sid, b); }
    if (e.lensBrand) b.lens[e.lensBrand] = (b.lens[e.lensBrand] || 0) + 1;
    if (e.frameBrand) b.frame[e.frameBrand] = (b.frame[e.frameBrand] || 0) + 1;
    if (!e.payment) continue; // unpaid exam contributes 0 业绩
    rawRows.push({
      staffId: sid, staffName,
      storeId: e.registeredStoreId, storeName: e.registeredStoreName,
      consumeCents: e.payment.balanceDeduct + e.payment.beansDeductAmount,
    });
  }
  const perf = aggregatePerformance(rawRows as any);

  // 3. Merge in optical staff with 0 业绩 (B.1) + fill open count + brands.
  const perfByStaff = new Map(perf.map((p) => [p.staffId, p]));
  for (const s of opticalStaff) {
    if (!perfByStaff.has(s.id)) {
      const empty = { staffId: s.id, staffName: s.name, opticalConsumeCents: 0, storeBreakdown: [], commissionCents: 0, openCount: 0 };
      perfByStaff.set(s.id, empty as any);
      perf.push(empty as any);
    }
  }
  for (const row of perf) {
    const opened = await prisma.member.count({
      where: { registeredBy: row.staffId, registeredAt: { gte: monthStart, lt: monthEnd } },
    });
    row.openCount = opened;
    (row as any).brands = brandByStaff.get(row.staffId) || { lens: {}, frame: {} };
  }

  res.json({ year, month, items: perf, commissionForMerged });
});

// Single staff across months (柱状图 dimension 2). Keyed by exam.registeredBy (B.2/E).
statsRouter.get('/performance/:staffId', async (req, res) => {
  const year = Number(req.query.year) || new Date().getFullYear();
  const staffId = req.params.staffId;
  const out = [];
  for (let m = 1; m <= 12; m++) {
    const monthStart = new Date(year, m - 1, 1);
    const monthEnd = new Date(year, m, 1);
    // 配镜部 exams registered by this staff in month, with payments.
    const exams = await prisma.examRecord.findMany({
      where: { registeredBy: staffId, dept: 'OPTICAL', registeredAt: { gte: monthStart, lt: monthEnd }, deletedAt: null, voidedAt: null },
      include: { payment: true },
    });
    let total = 0;
    const storeBreakdown = new Map<string, { storeId: string; storeName: string; consume: number }>();
    for (const e of exams) {
      if (!e.payment) continue;
      const consume = e.payment.balanceDeduct + e.payment.beansDeductAmount;
      total += consume;
      let b = storeBreakdown.get(e.registeredStoreId);
      if (!b) { b = { storeId: e.registeredStoreId, storeName: e.registeredStoreName, consume: 0 }; storeBreakdown.set(e.registeredStoreId, b); }
      b.consume += consume;
    }
    out.push({ month: m, consume: total, commission: commissionForMerged(total), storeBreakdown: [...storeBreakdown.values()] });
  }
  res.json({ year, items: out });
});

// ---------- Member / exam counts (dashboard) ----------
statsRouter.get('/dashboard', async (req, res) => {
  const now = new Date();
  const todayStart = new Date(now.getFullYear(), now.getMonth(), now.getDate());
  const weekLater = new Date(now.getTime() + 7 * 86400000);

  const [memberCount, examCount, todayNewMembers, birthdayToday, reviewDue, openAnomalies] = await Promise.all([
    prisma.member.count({ where: { status: 'ACTIVE' } }),
    // B.6: voided unpaid drafts are not real business — exclude from the dashboard count.
    // §2.5: discarded revisions also excluded (avoid double-counting a revised exam).
    prisma.examRecord.count({ where: { deletedAt: null, voidedAt: null, discardedAt: null } }),
    prisma.member.count({ where: { registeredAt: { gte: todayStart } } }),
    // birthday today (by month+day)
    prisma.customer.count({
      where: { isMember: true, deletedAt: null },
    }).then(async () => {
      // SQLite can't query month/day easily; fetch and filter in JS
      const customers = await prisma.customer.findMany({ where: { isMember: true, deletedAt: null, birthday: { not: null } }, select: { birthday: true } });
      return customers.filter((c) => { const b = new Date(c.birthday!); return b.getMonth() === now.getMonth() && b.getDate() === now.getDate(); }).length;
    }),
    // B.6: voided drafts excluded from review-due count. §2.5: discarded too.
    prisma.examRecord.count({
      where: { deletedAt: null, voidedAt: null, discardedAt: null, reviewStatus: { in: ['PENDING', 'CONTACTED'] }, reviewDate: { lte: weekLater } },
    }),
    prisma.anomalyRecord.count({ where: { status: 'OPEN' } }),
  ]);
  res.json({ memberCount, examCount, todayNewMembers, birthdayToday, reviewDue, openAnomalies });
});

// ---------- Anomaly review list (§6.7) ----------
statsRouter.get('/anomalies', async (_req, res) => {
  const items = await prisma.anomalyRecord.findMany({ where: { status: 'OPEN' }, orderBy: { createdAt: 'desc' } });
  const out = items.map((a) => ({ ...a, conflictLedgerIds: a.conflictLedgerIds ? JSON.parse(a.conflictLedgerIds) : [] }));
  res.json({ items: out });
});
statsRouter.get('/anomalies/:id/ledgers', async (req, res) => {
  const anomaly = await prisma.anomalyRecord.findUnique({ where: { id: req.params.id } });
  if (!anomaly) return res.status(404).json({ error: '异常记录不存在' });
  const ids: string[] = anomaly.conflictLedgerIds ? JSON.parse(anomaly.conflictLedgerIds) : [];
  const ledgers = ids.length ? await prisma.ledger.findMany({ where: { id: { in: ids } }, orderBy: { createdAt: 'desc' } }) : [];
  res.json({ anomaly, ledgers });
});
statsRouter.post('/anomalies/:id/resolve', async (req, res) => {
  const { resolvedByName, resolveNote } = req.body || {};
  if (!resolveNote) return res.status(400).json({ error: '必须填写核实说明' });
  const a = await prisma.anomalyRecord.update({
    where: { id: req.params.id },
    data: { status: 'RESOLVED', resolvedAt: new Date(), resolvedByName: resolvedByName || '后台', resolveNote },
  });
  res.json(a);
});

// ---------- Recycle bin (§6.1, 30d retention) ----------
statsRouter.get('/recycle', async (req, res) => {
  const cutoff = new Date(Date.now() - RECYCLE_RETENTION_DAYS * 86400000);
  const items = await prisma.recycleBinEntry.findMany({ where: { deletedAt: { gte: cutoff } }, orderBy: { deletedAt: 'desc' } });
  res.json({ items });
});
// Recycle bin stores entityType as a short alias ("EXAM", "MEMBER", ...), but
// Prisma delegate keys are the lowercased model names. For most models that's a
// simple first-letter-lowercase, but ExamRecord's model name is "ExamRecord"
// (delegate "examRecord") — so the alias "EXAM" must NOT be naively converted
// (it would yield "eXAM" -> undefined delegate -> restore always throws, and
// permanent-delete silently swallowed the error leaving orphan rows).
// Map explicitly so future soft-delete entity types just add a line here.
const ENTITY_MODEL_KEY: Record<string, string> = {
  EXAM: 'examRecord',
  MEMBER: 'member',
  CUSTOMER: 'customer',
};
function recycleDelegate(entityType: string): string | null {
  return ENTITY_MODEL_KEY[entityType] || null;
}

statsRouter.post('/recycle/:id/restore', async (req, res) => {
  const entry = await prisma.recycleBinEntry.findUnique({ where: { id: req.params.id } });
  if (!entry) return res.status(404).json({ error: '记录不存在' });
  const key = recycleDelegate(entry.entityType);
  if (!key) return res.status(400).json({ error: '未知的实体类型: ' + entry.entityType });
  try {
    await (prisma as any)[key].update({ where: { id: entry.entityId }, data: { deletedAt: null } });
    await prisma.recycleBinEntry.delete({ where: { id: entry.id } });
    res.json({ ok: true });
  } catch (e: any) {
    res.status(400).json({ error: '恢复失败: ' + e.message });
  }
});
statsRouter.delete('/recycle/:id', async (req, res) => {
  // permanently delete (only allowed after 30d retention per spec; here admin force-delete)
  const entry = await prisma.recycleBinEntry.findUnique({ where: { id: req.params.id } });
  if (!entry) return res.status(404).json({ error: '记录不存在' });
  const key = recycleDelegate(entry.entityType);
  if (!key) return res.status(400).json({ error: '未知的实体类型: ' + entry.entityType });
  try {
    // Do NOT swallow the error: silently ignoring it left the underlying row in
    // the DB (deletedAt still set) while the RecycleBinEntry was removed,
    // producing orphan data that is neither restorable nor purgeable.
    await (prisma as any)[key].delete({ where: { id: entry.entityId } });
    await prisma.recycleBinEntry.delete({ where: { id: entry.id } });
    res.json({ ok: true });
  } catch (e: any) {
    res.status(400).json({ error: '永久删除失败: ' + e.message });
  }
});

// ---------- Audit log query (§7.3) ----------
statsRouter.get('/audit', async (req, res) => {
  const { year, month, day, action, entityType } = req.query as Record<string, string>;
  const where: any = {};
  if (action) where.action = action;
  if (entityType) where.entityType = entityType;
  if (year) {
    const from = new Date(Number(year), month ? Number(month) - 1 : 0, day ? Number(day) : 1);
    const to = day ? new Date(Number(year), Number(month) - 1, Number(day) + 1) : (month ? new Date(Number(year), Number(month), 1) : new Date(Number(year) + 1, 0, 1));
    where.createdAt = { gte: from, lt: to };
  }
  const items = await prisma.auditLog.findMany({ where, orderBy: { createdAt: 'desc' }, take: 1000 });
  res.json({ items: items.map((a) => ({ ...a, details: a.details ? JSON.parse(a.details) : null })) });
});

// ---------- Export (§7.4): CSV of members / exams / payments ----------
statsRouter.get('/export/:type', async (req, res) => {
  const type = req.params.type; // members | exams | payments | recharges
  const storeId = req.query.storeId as string | undefined;
  res.setHeader('Content-Type', 'text/csv; charset=utf-8');
  res.setHeader(`Content-Disposition`, `attachment; filename="${type}.csv"`);

  const lines: string[] = [];
  const q = (s: any) => `"${String(s ?? '').replace(/"/g, '""')}"`;

  if (type === 'members') {
    lines.push(['卡号', '姓名', '手机号', '生日', '档位', '累计积分', '豆', '余额', '登记人', '登记门店', '登记时间'].map(q).join(','));
    const where: any = { status: 'ACTIVE' };
    if (storeId) where.registeredStoreId = storeId;
    const members = await prisma.member.findMany({ where, include: { customer: true, ledgers: true } });
    const tiers = await prisma.tierRule.findMany({ orderBy: { minPoints: 'asc' } });
    const { computeTier, sumLedger } = await import('@clinic/shared');
    for (const m of members) {
      const s = sumLedger(m.ledgers as any);
      const t = computeTier(s.points, tiers as any);
      lines.push([m.cardNo, m.customer?.name, m.customer?.phone, formatDate(m.customer?.birthday), t.name, s.points, s.beans, formatCents(s.balanceCents), m.registeredByName, m.registeredStoreName, formatDateTime(m.registeredAt)].map(q).join(','));
    }
  } else if (type === 'exams') {
    lines.push(['登记时间', '部门', '姓名', '手机号', '镜片品牌', '镜片价格', '镜架品牌', '镜架价格', '总金额', '复查日期', '复查状态', '登记人', '登记门店'].map(q).join(','));
    // B.6: exclude voided unpaid drafts from export (they're not real business).
    const where: any = { deletedAt: null, voidedAt: null };
    if (storeId) where.registeredStoreId = storeId;
    const exams = await prisma.examRecord.findMany({ where, include: { customer: true } });
    const { REVIEW_STATUS_LABELS } = await import('@clinic/shared');
    for (const e of exams) {
      lines.push([formatDateTime(e.registeredAt), e.dept === 'OPTICAL' ? '配镜部' : '眼科部', e.customer?.name, e.customer?.phone, e.lensBrand, formatCents(e.lensPrice), e.frameBrand, formatCents(e.framePrice), formatCents(e.totalAmount), formatDate(e.reviewDate), REVIEW_STATUS_LABELS[e.reviewStatus] || e.reviewStatus, e.registeredByName, e.registeredStoreName].map(q).join(','));
    }
  } else if (type === 'payments') {
    lines.push(['支付时间', '部门', '客户', '应付', '折后', '余额抵扣', '豆抵扣', '豆抵扣金额', '实付现金', '获得豆', '获得积分', '代付会员', '操作人', '门店'].map(q).join(','));
    const where: any = {};
    if (storeId) where.storeId = storeId;
    const pays = await prisma.payment.findMany({ where, include: { exam: true }, orderBy: { createdAt: 'desc' } });
    for (const p of pays) {
      lines.push([formatDateTime(p.createdAt), p.exam?.dept === 'OPTICAL' ? '配镜部' : '眼科部', p.exam?.customerId || '', formatCents(p.baseAmount), formatCents(p.afterDiscount), formatCents(p.balanceDeduct), p.beansDeduct, formatCents(p.beansDeductAmount), formatCents(p.cashPaid), p.beansAwarded, p.pointsAwarded, p.payForMemberName, p.operatorName, p.storeName].map(q).join(','));
    }
  } else if (type === 'recharges') {
    lines.push(['充值时间', '卡号', '现金', '储值增加', '赠送豆', '赠送积分', '操作人', '门店'].map(q).join(','));
    const where: any = {};
    if (storeId) where.storeId = storeId;
    const rc = await prisma.recharge.findMany({ where, orderBy: { createdAt: 'desc' } });
    for (const r of rc) {
      lines.push([formatDateTime(r.createdAt), r.cardNo, formatCents(r.cashPaid), formatCents(r.balanceAdded), r.beansGifted, r.pointsGifted, r.operatorName, r.storeName].map(q).join(','));
    }
  } else {
    return res.status(400).send('unknown type');
  }
  res.send('\ufeff' + lines.join('\n'));
});
