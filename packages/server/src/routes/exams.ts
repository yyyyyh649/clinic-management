// Exam routes (admin SPA). Mounted under requireBackend.
import { Router } from 'express';
import { v4 as uuid } from 'uuid';
import { prisma } from '../db.js';
import { DEPT, DEFAULT_REVIEW_DAYS, REVIEW_STATUS } from '@clinic/shared';
import { computeAge, reviewDaysRemaining, isPendingReview } from '@clinic/shared';
import { verifyPassword, PASSWORD_KEY } from '../passwords.js';

export const examRouter = Router();

// ---------- List (filters + 需复查置顶 + 登记时间倒序) ----------
// B.6: by default only PAID exams are returned (未支付的算"进行中的草稿", only in 待支付).
//      Pass ?include=unpaid to see unpaid drafts (待支付 entry). Voided drafts never show.
examRouter.get('/', async (req, res) => {
  const { dept, storeId, status, include } = req.query as Record<string, string>;
  const daysToReview = req.query.daysToReview ? Number(req.query.daysToReview) : undefined;
  const ageMin = req.query.ageMin ? Number(req.query.ageMin) : undefined;
  const ageMax = req.query.ageMax ? Number(req.query.ageMax) : undefined;

  const where: any = { deletedAt: null, voidedAt: null };
  if (dept) where.dept = dept;
  if (storeId) where.registeredStoreId = storeId;
  if (status) where.reviewStatus = status;
  // Default: only paid exams. ?include=unpaid shows unpaid drafts (待支付 list).
  if (include !== 'unpaid') where.payment = { isNot: null };

  const exams = await prisma.examRecord.findMany({
    where,
    include: { customer: true, payment: true },
    orderBy: { registeredAt: 'desc' },
  });

  const now = new Date();
  let rows = exams.map((e) => {
    const age = computeAge(e.customer?.birthday);
    const days = reviewDaysRemaining(e.reviewDate, now);
    return {
      id: e.id, dept: e.dept, deptLabel: e.dept === DEPT.OPTICAL ? '配镜部' : '眼科部',
      customerName: e.customer?.name, phone: e.customer?.phone, age,
      registeredBy: e.registeredByName, registeredAt: e.registeredAt,
      registeredStoreName: e.registeredStoreName, registeredStoreId: e.registeredStoreId,
      reviewDate: e.reviewDate, reviewStatus: e.reviewStatus, daysToReview: days,
      needsReview: isPendingReview(e as any, now),
      lensBrand: e.lensBrand, frameBrand: e.frameBrand,
      baseAmount: e.baseAmount, hasPayment: !!e.payment,
    };
  });

  if (daysToReview !== undefined) rows = rows.filter((r) => r.daysToReview !== null && r.daysToReview <= daysToReview);
  if (ageMin !== undefined) rows = rows.filter((r) => (r.age ?? -1) >= ageMin);
  if (ageMax !== undefined) rows = rows.filter((r) => (r.age ?? Infinity) <= ageMax);

  // sort: 需复查置顶; 已联系不到店 移到底; 其余 登记时间倒序
  const rank = (r: typeof rows[number]) => {
    if (r.reviewStatus === REVIEW_STATUS.CONTACTED_NO_SHOW) return 2;
    if (r.needsReview) return 0;
    return 1;
  };
  rows.sort((a, b) => {
    const ra = rank(a), rb = rank(b);
    if (ra !== rb) return ra - rb;
    return new Date(b.registeredAt).getTime() - new Date(a.registeredAt).getTime();
  });

  res.json({ items: rows });
});

// ---------- Detail + customer's full history ----------
// B.7: payment (if any) is included so the detail page can show the full breakdown.
examRouter.get('/:id', async (req, res) => {
  const exam = await prisma.examRecord.findUnique({
    where: { id: req.params.id },
    include: { customer: { include: { member: true } }, payment: true },
  });
  if (!exam) return res.status(404).json({ error: '检查记录不存在' });
  // history excludes voided drafts (B.6).
  const history = await prisma.examRecord.findMany({
    where: { customerId: exam.customerId, deletedAt: null, voidedAt: null, id: { not: exam.id } },
    orderBy: { registeredAt: 'desc' },
  });
  res.json({ exam: { ...exam, content: exam.content ? JSON.parse(exam.content) : [] }, customer: exam.customer, history, age: computeAge(exam.customer?.birthday) });
});

// ---------- Create ----------
examRouter.post('/', async (req, res) => {
  const {
    customerId, // optional: reuse existing customer
    name, phone, age, address, birthday,
    dept, templateId, templateName, content,
    lensBrand, lensPrice, frameBrand, framePrice, totalAmount,
    reviewDate, reviewerId, reviewerName, reviewNote,
    registeredById, registeredByName, registeredStoreId, registeredStoreName, registeredDeviceId,
    registeredAt, // 可自定义登记时间（默认当前时间），允许补录历史登记
  } = req.body || {};

  if (!name || !phone || !dept || !registeredById) return res.status(400).json({ error: '姓名、手机号、部门、登记人必填' });
  if (dept === DEPT.OPTICAL && (lensPrice == null || framePrice == null)) return res.status(400).json({ error: '配镜部镜片和镜架价格必填' });
  if (dept === DEPT.EYE && totalAmount == null) return res.status(400).json({ error: '眼科部总金额必填' });

  // dedup customer by phone (reuse if phone+name match)
  let customer = customerId ? await prisma.customer.findUnique({ where: { id: customerId } }) : null;
  if (!customer) {
    const existing = await prisma.customer.findFirst({ where: { phone, name } });
    customer = existing ?? await prisma.customer.create({
      data: {
        id: uuid(), name, phone, birthday: birthday ? new Date(birthday) : null, address,
        createdByStaffId: registeredById, createdByStoreId: registeredStoreId, createdByDeviceId: registeredDeviceId,
      },
    });
  }

  const baseAmount = dept === DEPT.OPTICAL ? (Number(lensPrice) || 0) + (Number(framePrice) || 0) : (Number(totalAmount) || 0);
  const review = reviewDate ? new Date(reviewDate) : new Date(Date.now() + DEFAULT_REVIEW_DAYS * 86400000);
  const regAt = registeredAt ? new Date(registeredAt) : new Date();

  const exam = await prisma.examRecord.create({
    data: {
      id: uuid(), customerId: customer.id, dept, templateId: templateId || null, templateName: templateName || null,
      content: content ? JSON.stringify(content) : null,
      lensBrand: lensBrand || null, lensPrice: dept === DEPT.OPTICAL ? Number(lensPrice) : null,
      frameBrand: frameBrand || null, framePrice: dept === DEPT.OPTICAL ? Number(framePrice) : null,
      totalAmount: dept === DEPT.EYE ? Number(totalAmount) : null,
      baseAmount,
      reviewDate: review, reviewerId: reviewerId || null, reviewerName: reviewerName || null, reviewStatus: 'PENDING', reviewNote: reviewNote || null,
      registeredBy: registeredById, registeredByName: registeredByName || '',
      registeredStoreId, registeredStoreName: registeredStoreName || '', registeredDeviceId: registeredDeviceId || '',
      registeredAt: regAt,
    },
  });
  res.json(exam);
});

// ---------- Edit exam (全字段可改，需 CHANGE 修改密码) ----------
// 相当于重新填一次检查单：登记时间、复查日期、模板内容、品牌价格、登记人均可改。
// payment 是独立记录，此处不动（如需改支付另行处理）。需先校验敏感信息修改密码。
examRouter.put('/:id', async (req, res) => {
  const exam = await prisma.examRecord.findUnique({ where: { id: req.params.id } });
  if (!exam) return res.status(404).json({ error: '检查记录不存在' });

  const { changePassword: cp } = req.body || {};
  const ok = await verifyPassword(prisma, PASSWORD_KEY.CHANGE, cp || '');
  if (!ok) return res.status(403).json({ error: '修改检查单需要敏感信息修改密码验证通过' });

  const {
    dept, templateId, templateName, content,
    lensBrand, lensPrice, frameBrand, framePrice, totalAmount,
    reviewDate, reviewerId, reviewerName, reviewNote,
    registeredById, registeredByName, registeredAt,
  } = req.body || {};

  const d = dept || exam.dept;
  const baseAmount = d === DEPT.OPTICAL
    ? (Number(lensPrice ?? exam.lensPrice) || 0) + (Number(framePrice ?? exam.framePrice) || 0)
    : (Number(totalAmount ?? exam.totalAmount) || 0);

  const data: any = {};
  if (dept !== undefined) data.dept = d;
  if (templateId !== undefined) data.templateId = templateId || null;
  if (templateName !== undefined) data.templateName = templateName || null;
  if (content !== undefined) data.content = content ? JSON.stringify(content) : null;
  if (lensBrand !== undefined) data.lensBrand = lensBrand || null;
  if (lensPrice !== undefined) data.lensPrice = d === DEPT.OPTICAL ? Number(lensPrice) : null;
  if (frameBrand !== undefined) data.frameBrand = frameBrand || null;
  if (framePrice !== undefined) data.framePrice = d === DEPT.OPTICAL ? Number(framePrice) : null;
  if (totalAmount !== undefined) data.totalAmount = d === DEPT.EYE ? Number(totalAmount) : null;
  data.baseAmount = baseAmount;
  if (reviewDate !== undefined) data.reviewDate = new Date(reviewDate);
  if (reviewerId !== undefined) data.reviewerId = reviewerId || null;
  if (reviewerName !== undefined) data.reviewerName = reviewerName || null;
  if (reviewNote !== undefined) data.reviewNote = reviewNote || null;
  if (registeredById !== undefined) data.registeredBy = registeredById;
  if (registeredByName !== undefined) data.registeredByName = registeredByName;
  if (registeredAt) data.registeredAt = new Date(registeredAt);

  const updated = await prisma.examRecord.update({ where: { id: exam.id }, data });
  res.json(updated);
});

// ---------- Review status update ----------
examRouter.put('/:id/review', async (req, res) => {
  const { reviewStatus, reviewerId, reviewerName, reviewNote } = req.body || {};
  if (!reviewStatus || !['PENDING', 'CONTACTED', 'CONTACTED_NO_SHOW', 'REVIEWED'].includes(reviewStatus)) {
    return res.status(400).json({ error: '无效复查状态' });
  }
  const exam = await prisma.examRecord.update({
    where: { id: req.params.id },
    data: { reviewStatus, reviewerId, reviewerName, reviewNote },
  });
  res.json(exam);
});

// ---------- Void an unpaid draft (B.6) ----------
// Only exams WITHOUT a payment can be voided. Voiding sets voidedAt, removing the
// draft from all lists/stats without going through the recycle bin (it never
// constituted a completed business transaction).
examRouter.post('/:id/void', async (req, res) => {
  const exam = await prisma.examRecord.findUnique({ where: { id: req.params.id }, include: { payment: true } });
  if (!exam) return res.status(404).json({ error: '检查记录不存在' });
  if (exam.voidedAt) return res.status(400).json({ error: '该记录已作废' });
  if (exam.payment) return res.status(400).json({ error: '已支付的记录不能作废，如需删除请走回收站' });
  const updated = await prisma.examRecord.update({
    where: { id: exam.id },
    data: { voidedAt: new Date() },
  });
  res.json({ ok: true, voidedAt: updated.voidedAt });
});

// ---------- Soft delete (to recycle bin, 30d retention) ----------
examRouter.delete('/:id', async (req, res) => {
  const { operatorId, operatorName, storeId, storeName } = req.body || {};
  const exam = await prisma.examRecord.findUnique({ where: { id: req.params.id } });
  if (!exam) return res.status(404).json({ error: '记录不存在' });
  await prisma.$transaction([
    prisma.examRecord.update({ where: { id: exam.id }, data: { deletedAt: new Date() } }),
    prisma.recycleBinEntry.create({
      data: {
        entityType: 'EXAM', entityId: exam.id, entitySnapshot: JSON.stringify(exam),
        deletedBy: operatorId || 'admin', deletedByName: operatorName || '后台',
        sourceStoreId: storeId || exam.registeredStoreId, sourceStoreName: storeName || exam.registeredStoreName,
      },
    }),
  ]);
  res.json({ ok: true });
});
