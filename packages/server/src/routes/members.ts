// Member + customer routes (admin SPA). Mounted under requireBackend except dedup/lookup.
import { Router } from 'express';
import { prisma } from '../db.js';
import { v4 as uuid } from 'uuid';
import {
  LEDGER_FIELD, LEDGER_SOURCE, DEPT, computeBatchExpiry, computeTier, selectFIFOConsume,
  type BeanExpirySetting,
} from '@clinic/shared';
import {
  loadMemberDetail, loadBalances, computeAge, memberDaysSince, isPendingReview, reviewDaysRemaining,
} from '@clinic/shared';
import { verifyPassword, PASSWORD_KEY } from '../passwords.js';

export const memberRouter = Router();

// ---------- Customer dedup (used by registration) ----------
memberRouter.get('/customers/dedup', async (req, res) => {
  const phone = String(req.query.phone || '');
  const name = String(req.query.name || '');
  if (!phone) return res.json({ found: false });
  const customers = await prisma.customer.findMany({ where: { phone, deletedAt: null }, include: { member: true } });
  if (customers.length === 0) return res.json({ found: false });
  const exact = customers.find((c) => c.name === name);
  if (exact) return res.json({ found: true, mode: 'reuse', customer: exact });
  // phone exists but name differs → conflict (may be a family sharing one phone)
  return res.json({ found: true, mode: 'conflict', customers });
});

// Search customers/members by name/phone/card-no (for 代付 etc.)
memberRouter.get('/search', async (req, res) => {
  const q = String(req.query.q || '').trim();
  if (!q) return res.json({ items: [] });
  const byCard = req.query.byCard === '1';
  const members = await prisma.member.findMany({
    where: byCard
      ? { OR: [{ cardNo: { contains: q } }, { cardNo: { endsWith: q } }] }
      : {
          OR: [
            { customer: { name: { contains: q } } },
            { customer: { phone: { contains: q } } },
            { cardNo: { contains: q } },
          ],
        },
    include: { customer: true },
    take: 30,
  });
  res.json({ items: members });
});

// ---------- Member list (filters + 待复查置顶 + 最新登记倒序) ----------
memberRouter.get('/', async (req, res) => {
  const { tier: tierLevel, storeId, dateFrom, dateTo } = req.query as Record<string, string>;
  const ageMin = req.query.ageMin ? Number(req.query.ageMin) : undefined;
  const ageMax = req.query.ageMax ? Number(req.query.ageMax) : undefined;

  const where: any = { status: 'ACTIVE', deletedAt: null };
  if (storeId) where.registeredStoreId = storeId;
  if (dateFrom || dateTo) {
    where.registeredAt = {};
    if (dateFrom) where.registeredAt.gte = new Date(dateFrom);
    if (dateTo) where.registeredAt.lte = new Date(dateTo + 'T23:59:59');
  }

  const members = await prisma.member.findMany({
    where,
    include: { customer: true, ledgers: true },
    orderBy: { registeredAt: 'desc' },
  });

  const tiers = await prisma.tierRule.findMany({ orderBy: { minPoints: 'asc' } });
  const now = new Date();

  // Enrich with balances, tier, age, pending-review flag, days-since-register.
  let rows = await Promise.all(members.map(async (m) => {
    const bal = await loadBalances(prisma, m.id, now);
    const tier = computeTier(bal.points, tiers as any);
    const age = computeAge(m.customer?.birthday);
    // pending review: any exam (cross-store) due & not closed
    const dueExam = await prisma.examRecord.findFirst({
      where: {
        customerId: m.customerId, deletedAt: null,
        reviewStatus: { in: ['PENDING', 'CONTACTED'] },
        reviewDate: { lte: new Date(now.getTime() + 7 * 86400000) },
      },
    });
    const pendingReview = !!dueExam;
    return {
      id: m.id, cardNo: m.cardNo, name: m.customer?.name, phone: m.customer?.phone,
      birthday: m.customer?.birthday, age,
      tierName: tier.name, tierLevel: tier.level,
      points: bal.points, beans: bal.beans, balanceCents: bal.balanceCents,
      registeredAt: m.registeredAt, daysSince: memberDaysSince(m.registeredAt, now),
      registeredBy: m.registeredByName, registeredStoreName: m.registeredStoreName,
      registeredStoreId: m.registeredStoreId,
      pendingReview,
    };
  }));

  // tier filter (after computing tier) + age filter
  if (tierLevel) rows = rows.filter((r) => r.tierLevel === Number(tierLevel));
  if (ageMin !== undefined) rows = rows.filter((r) => (r.age ?? -1) >= ageMin);
  if (ageMax !== undefined) rows = rows.filter((r) => (r.age ?? Infinity) <= ageMax);

  // sort: 待复查置顶, then 最新登记倒序
  rows.sort((a, b) => {
    if (a.pendingReview !== b.pendingReview) return a.pendingReview ? -1 : 1;
    return new Date(b.registeredAt).getTime() - new Date(a.registeredAt).getTime();
  });

  res.json({ items: rows });
});

// ---------- Member detail ----------
memberRouter.get('/:id', async (req, res) => {
  const detail = await loadMemberDetail(prisma, req.params.id);
  if (!detail) return res.status(404).json({ error: '会员不存在' });
  const tiers = await prisma.tierRule.findMany({ orderBy: { minPoints: 'asc' } });
  const tier = computeTier(detail.balances.points, tiers as any);
  res.json({ ...detail, tier, age: computeAge(detail.customer?.birthday) });
});

// ---------- Register member ----------
memberRouter.post('/', async (req, res) => {
  const {
    name, phone, cardNo, birthday, address, registeredById, registeredByName,
    registeredStoreId, registeredStoreName, registeredDeviceId,
    initialBalanceCents = 0, initialBeans = 0, // 选填初始余额/豆
    customerId: existingCustomerId, // if reusing an existing customer
    operatorMemberId,
  } = req.body || {};

  if (!name || !phone || !cardNo || !birthday || !registeredById) {
    return res.status(400).json({ error: '姓名、手机号、卡号、生日、登记人必填' });
  }
  // card uniqueness
  const dup = await prisma.member.findUnique({ where: { cardNo } });
  if (dup) return res.status(400).json({ error: '该会员卡号已存在' });

  const setting: BeanExpirySetting = await loadBeanExpirySetting();

  const result = await prisma.$transaction(async (tx) => {
    // 1. customer: reuse or create (same customer_id across history)
    let customer = existingCustomerId ? await tx.customer.findUnique({ where: { id: existingCustomerId } }) : null;
    if (!customer) {
      customer = await tx.customer.create({
        data: {
          id: uuid(), name, phone, birthday: new Date(birthday), address,
          isMember: true,
          createdByStaffId: registeredById, createdByStoreId: registeredStoreId, createdByDeviceId: registeredDeviceId,
        },
      });
    } else if (!customer.isMember) {
      // link this customer to the new member
    } else if (customer.memberId) {
      throw new Error('该客户已是会员');
    }

    const memberId = uuid();
    const member = await tx.member.create({
      data: {
        id: memberId, customerId: customer.id, cardNo,
        registeredBy: registeredById, registeredByName: registeredByName || '',
        registeredStoreId, registeredStoreName: registeredStoreName || '',
        registeredAt: new Date(),
      },
    });
    await tx.customer.update({ where: { id: customer.id }, data: { isMember: true, memberId } });

    // 2. init ledger: balance + beans (POINTS starts 0, grows via awards)
    if (Number(initialBalanceCents) > 0) {
      await tx.ledger.create({
        data: {
          id: uuid(), memberId, field: LEDGER_FIELD.BALANCE, delta: Number(initialBalanceCents),
          source: LEDGER_SOURCE.INIT, reason: '开卡初始余额', refType: 'INIT',
          operatorId: registeredById, operatorName: registeredByName || '',
          storeId: registeredStoreId, storeName: registeredStoreName || '', deviceId: registeredDeviceId || '',
          syncStatus: 'SYNCED', origin: 'SERVER',
        },
      });
    }
    if (Number(initialBeans) > 0) {
      const batchId = uuid();
      const expiresAt = computeBatchExpiry(new Date(), setting);
      await tx.beanBatch.create({
        data: { id: batchId, memberId, remaining: Number(initialBeans), total: Number(initialBeans), expiresAt, source: 'INIT', refId: member.id },
      });
      await tx.ledger.create({
        data: {
          id: uuid(), memberId, field: LEDGER_FIELD.BEANS, delta: Number(initialBeans),
          source: LEDGER_SOURCE.INIT, reason: '开卡初始豆', refType: 'INIT', beanBatchId: batchId,
          operatorId: registeredById, operatorName: registeredByName || '',
          storeId: registeredStoreId, storeName: registeredStoreName || '', deviceId: registeredDeviceId || '',
          syncStatus: 'SYNCED', origin: 'SERVER',
        },
      });
    }
    return member;
  });

  res.json(await loadMemberDetail(prisma, result.id));
});

// ---------- Edit member info (phone change -> PhoneHistory) ----------
memberRouter.put('/:id', async (req, res) => {
  const { name, phone, address, birthday, changePassword: cp } = req.body || {};
  const member = await prisma.member.findUnique({ where: { id: req.params.id }, include: { customer: true } });
  if (!member) return res.status(404).json({ error: '会员不存在' });

  // Changing name/phone/birthday counts as 敏感信息修改 -> requires CHANGE password + 二次确认 (client handles 二次)
  const touchingSensitive = phone !== undefined && phone !== member.customer.phone;
  if (touchingSensitive) {
    const ok = await verifyPassword(prisma, PASSWORD_KEY.CHANGE, cp || '');
    if (!ok) return res.status(403).json({ error: '修改手机号需要敏感信息修改密码验证通过' });
  }

  const customer = member.customer!;
  if (touchingSensitive) {
    await prisma.phoneHistory.create({
      data: {
        id: uuid(), customerId: customer.id, oldPhone: customer.phone, newPhone: phone,
        changedBy: req.body.operatorId || 'admin', changedByName: req.body.operatorName || '后台',
        storeId: req.body.storeId, reason: req.body.reason || '后台修改',
      },
    });
  }
  const updated = await prisma.customer.update({
    where: { id: customer.id },
    data: { name, phone: touchingSensitive ? phone : undefined, address, birthday: birthday ? new Date(birthday) : undefined },
  });
  res.json({ ok: true });
});

// ---------- Adjust balance / beans / points (Ledger 增量, reason required) ----------
memberRouter.post('/:id/ledger', async (req, res) => {
  const { field, delta, reason, operatorId, operatorName, storeId, storeName, deviceId } = req.body || {};
  if (!field || delta === undefined) return res.status(400).json({ error: '字段和增减量必填' });
  if (!reason || !reason.trim()) return res.status(400).json({ error: '必须填写备注原因' });
  if (![LEDGER_FIELD.BALANCE, LEDGER_FIELD.BEANS, LEDGER_FIELD.POINTS].includes(field)) {
    return res.status(400).json({ error: '无效字段' });
  }
  const setting = await loadBeanExpirySetting();
  const memberId = req.params.id;
  const id = uuid();

  const entry = await prisma.$transaction(async (tx) => {
    let beanBatchId: string | undefined;
    if (field === LEDGER_FIELD.BEANS && Number(delta) > 0) {
      // positive beans create a new expiring batch
      const batchId = uuid();
      await tx.beanBatch.create({
        data: { id: batchId, memberId, remaining: Number(delta), total: Number(delta), expiresAt: computeBatchExpiry(new Date(), setting), source: 'AWARD', refId: id },
      });
      beanBatchId = batchId;
    } else if (field === LEDGER_FIELD.BEANS && Number(delta) < 0) {
      // negative beans => FIFO consume from batches
      const batches = await tx.beanBatch.findMany({ where: { memberId } });
      const plan = selectFIFOConsume(batches as any, Math.abs(Number(delta)));
      let leftToConsume = Math.abs(Number(delta));
      for (const p of plan) {
        const take = Math.min(leftToConsume, p.consume);
        await tx.beanBatch.update({ where: { id: p.batchId }, data: { remaining: { decrement: take } } });
        leftToConsume -= take;
      }
    }
    return tx.ledger.create({
      data: {
        id, memberId, field, delta: Number(delta), source: LEDGER_SOURCE.ADJUST,
        reason, refType: 'ADJUST', beanBatchId,
        operatorId: operatorId || 'admin', operatorName: operatorName || '后台',
        storeId: storeId || '', storeName: storeName || '', deviceId: deviceId || '',
        syncStatus: 'SYNCED', origin: 'SERVER',
      },
    });
  });

  // recompute anomaly for this member (e.g. manual fix resolves a negative)
  const { recomputeAnomalies } = await import('../anomaly.js');
  await recomputeAnomalies([memberId]);
  res.json(entry);
});

// ---------- 代付 usage records for a member card ----------
memberRouter.get('/:id/usage', async (req, res) => {
  const payments = await prisma.payment.findMany({
    where: { payForMemberId: req.params.id },
    orderBy: { createdAt: 'desc' },
    include: { exam: true },
  });
  res.json({ items: payments });
});

// ---------- Bean expiry setting helper ----------
export async function loadBeanExpirySetting(): Promise<BeanExpirySetting> {
  const [en, mo] = await Promise.all([
    prisma.setting.findUnique({ where: { key: 'beanExpiry.enabled' } }),
    prisma.setting.findUnique({ where: { key: 'beanExpiry.months' } }),
  ]);
  return { enabled: en?.value === 'true', months: mo ? Number(mo.value) : null };
}
