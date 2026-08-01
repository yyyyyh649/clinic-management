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
// §2.4: by default only ACTIVE exams are returned (discardedAt: null). Pass
//      ?include=discarded to also show superseded revisions (grey "已废弃" tag).
examRouter.get('/', async (req, res) => {
  const { dept, storeId, status, include } = req.query as Record<string, string>;
  const daysToReview = req.query.daysToReview ? Number(req.query.daysToReview) : undefined;
  const ageMin = req.query.ageMin ? Number(req.query.ageMin) : undefined;
  const ageMax = req.query.ageMax ? Number(req.query.ageMax) : undefined;

  const where: any = { deletedAt: null, voidedAt: null };
  // §2.4: hide discarded revisions unless explicitly requested.
  if (include !== 'discarded') where.discardedAt = null;
  if (dept) where.dept = dept;
  if (storeId) where.registeredStoreId = storeId;
  if (status) where.reviewStatus = status;
  // Default: only paid exams. ?include=unpaid shows unpaid drafts (待支付 list).
  // When showing discarded revisions, don't enforce the payment filter — a
  // discarded record may have a payment (the original was paid) and should still
  // appear when the user opts into "show discarded".
  if (include !== 'unpaid' && include !== 'discarded') where.payment = { isNot: null };

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
      discardedAt: e.discardedAt, revisesExamId: e.revisesExamId,
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
// §2.4: history shows ALL records (including discarded revisions) so the audit
//      trail is visible. Revision links let the user jump between old/new versions.
examRouter.get('/:id', async (req, res) => {
  const exam = await prisma.examRecord.findUnique({
    where: { id: req.params.id },
    include: { customer: { include: { member: true } }, payment: true },
  });
  if (!exam) return res.status(404).json({ error: '检查记录不存在' });
  // history excludes voided drafts (B.6) but KEEPS discarded revisions (§2.4).
  const history = await prisma.examRecord.findMany({
    where: { customerId: exam.customerId, deletedAt: null, voidedAt: null, id: { not: exam.id } },
    orderBy: { registeredAt: 'desc' },
  });
  // §2.4 revision links:
  //  - revisesExamId non-null => this record revised an older one (link to original).
  //  - discardedAt non-null   => this record was superseded; find the newer revision.
  let revisedBy: { id: string; createdAt: Date } | null = null;
  if (exam.discardedAt) {
    const newer = await prisma.examRecord.findFirst({
      where: { revisesExamId: exam.id }, select: { id: true, createdAt: true },
    });
    if (newer) revisedBy = newer;
  }
  res.json({
    exam: { ...exam, content: exam.content ? JSON.parse(exam.content) : [] },
    customer: exam.customer, history, age: computeAge(exam.customer?.birthday),
    revisedBy,
  });
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

// ---------- Edit exam (版本化保留：不覆盖旧记录，新增修正版 + 旧记录标记废弃) ----------
// §2.2: editing a (typically paid) exam no longer UPDATEs the original. Instead:
//   1. Mark the old record discardedAt = now (its Payment rows stay attached and
//      are never moved/rewritten — historical receipts are immutable).
//   2. Create a new ExamRecord with the modified values, revisesExamId = old.id,
//      discardedAt = null, createdAt = now. The new record starts UNPAID; if the
//      edit changed amounts, the user runs "继续支付" on the new record to settle
//      the difference (a brand-new Payment row that enters stats normally).
// Needs CHANGE password (verified inline, same request as the write — not a
// separate verify step, matching updateMember's "改内容+密码"一次性提交 pattern).
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

  const newId = uuid();
  const now = new Date();
  // 1. Mark old record as discarded (Payment rows on it are untouched).
  // 2. Create the revision with modified values. Immutable associations
  //    (customerId / registeredStoreId / registeredDeviceId) carry over from
  //    the old record; editable fields come from the request body.
  const [/* _old */, created] = await prisma.$transaction([
    prisma.examRecord.update({ where: { id: exam.id }, data: { discardedAt: now } }),
    prisma.examRecord.create({
      data: {
        id: newId,
        customerId: exam.customerId,
        dept: d,
        templateId: templateId !== undefined ? (templateId || null) : exam.templateId,
        templateName: templateName !== undefined ? (templateName || null) : exam.templateName,
        content: content !== undefined ? (content ? JSON.stringify(content) : null) : exam.content,
        lensBrand: lensBrand !== undefined ? (lensBrand || null) : exam.lensBrand,
        lensPrice: lensPrice !== undefined ? (d === DEPT.OPTICAL ? Number(lensPrice) : null) : exam.lensPrice,
        frameBrand: frameBrand !== undefined ? (frameBrand || null) : exam.frameBrand,
        framePrice: framePrice !== undefined ? (d === DEPT.OPTICAL ? Number(framePrice) : null) : exam.framePrice,
        totalAmount: totalAmount !== undefined ? (d === DEPT.EYE ? Number(totalAmount) : null) : exam.totalAmount,
        baseAmount,
        reviewDate: reviewDate !== undefined ? new Date(reviewDate) : exam.reviewDate,
        reviewerId: reviewerId !== undefined ? (reviewerId || null) : exam.reviewerId,
        reviewerName: reviewerName !== undefined ? (reviewerName || null) : exam.reviewerName,
        reviewStatus: exam.reviewStatus,
        reviewNote: reviewNote !== undefined ? (reviewNote || null) : exam.reviewNote,
        registeredBy: registeredById !== undefined ? registeredById : exam.registeredBy,
        registeredByName: registeredByName !== undefined ? registeredByName : exam.registeredByName,
        registeredStoreId: exam.registeredStoreId,
        registeredStoreName: exam.registeredStoreName,
        registeredDeviceId: exam.registeredDeviceId,
        registeredAt: registeredAt ? new Date(registeredAt) : exam.registeredAt,
        revisesExamId: exam.id,
        discardedAt: null,
      },
    }),
  ]);
  res.json(created);
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
