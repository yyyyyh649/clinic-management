// Exam CRUD shared service — the single source of truth for create/detail/
// list/void/review-status/update logic. Both the server (admin SPA via HTTP)
// and the Electron client (IPC against local DB) call these, mirroring how
// payment-service.ts deduplicates executePayment/executeRecharge.
//
// WHY: exams.ts (server) and handlers.ts (electron) previously copy-pasted
// the same create/update/void/list logic. That duplication was the root cause
// of "补丁没打全" bugs — e.g. recomputeBatchesFromLedger was added to
// payment-service + electron but missed on the server route. Funneling all
// exam writes through here means a fix lands once and reaches both paths.
//
// Password verification for sensitive edits (updateExam) is intentionally NOT
// done here — the server verifies against the local DB hash, the Electron
// client round-trips to the server. Both callers MUST verify BEFORE calling
// updateExam; the versioning write itself is password-agnostic.
import type { PrismaClient } from '../generated/client';
import { v4 as uuid } from 'uuid';
import { DEPT, DEFAULT_REVIEW_DAYS, REVIEW_STATUS } from './constants.js';
import { computeAge, reviewDaysRemaining, isPendingReview } from './db-helpers.js';

export class ExamError extends Error {}

// ---------- Create ----------
export interface CreateExamInput {
  customerId?: string;
  name: string;
  phone: string;
  address?: string;
  birthday?: string;
  dept: string;
  templateId?: string;
  templateName?: string;
  content?: unknown;
  lensBrand?: string;
  lensPrice?: number;
  frameBrand?: string;
  framePrice?: number;
  totalAmount?: number;
  reviewDate?: string;
  reviewerId?: string;
  reviewerName?: string;
  reviewNote?: string;
  registeredById: string;
  registeredByName?: string;
  registeredStoreId: string;
  registeredStoreName?: string;
  registeredDeviceId?: string;
  registeredAt?: string;
}

export async function createExam(prisma: PrismaClient, input: CreateExamInput) {
  const {
    customerId, name, phone, address, birthday,
    dept, templateId, templateName, content,
    lensBrand, lensPrice, frameBrand, framePrice, totalAmount,
    reviewDate, reviewerId, reviewerName, reviewNote,
    registeredById, registeredByName, registeredStoreId, registeredStoreName, registeredDeviceId,
    registeredAt,
  } = input;

  if (!name || !phone || !dept || !registeredById) throw new ExamError('姓名、手机号、部门、登记人必填');
  if (dept === DEPT.OPTICAL && (lensPrice == null || framePrice == null)) throw new ExamError('配镜部镜片和镜架价格必填');
  if (dept === DEPT.EYE && totalAmount == null) throw new ExamError('眼科部总金额必填');

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

  return prisma.examRecord.create({
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
}

// ---------- Detail + customer's full history ----------
// B.7: payment (if any) is included so the detail page can show the full breakdown.
// §2.4: history shows ALL records (including discarded revisions) so the audit
//      trail is visible. Revision links let the user jump between old/new versions.
export async function getExamDetail(prisma: PrismaClient, id: string) {
  const exam = await prisma.examRecord.findUnique({
    where: { id },
    include: { customer: { include: { member: true } }, payment: true },
  });
  if (!exam) throw new ExamError('检查记录不存在');
  // history excludes voided drafts (B.6) but KEEPS discarded revisions (§2.4).
  const history = await prisma.examRecord.findMany({
    where: { customerId: exam.customerId, deletedAt: null, voidedAt: null, id: { not: exam.id } },
    orderBy: { registeredAt: 'desc' },
  });
  // §2.4: if this record was superseded, find the newer revision for the banner link.
  let revisedBy: { id: string; createdAt: Date } | null = null;
  if (exam.discardedAt) {
    const newer = await prisma.examRecord.findFirst({
      where: { revisesExamId: exam.id }, select: { id: true, createdAt: true },
    });
    if (newer) revisedBy = newer;
  }
  return {
    exam: { ...exam, content: exam.content ? JSON.parse(exam.content) : [] },
    customer: exam.customer, history, age: computeAge(exam.customer?.birthday),
    revisedBy,
  };
}

// ---------- List (filters + 需复查置顶 + 登记时间倒序) ----------
// B.6: by default only PAID exams are returned (未支付的算"进行中的草稿").
//      ?include=unpaid shows unpaid drafts (待支付 entry). Voided drafts never show.
// §2.4: by default only ACTIVE exams (discardedAt: null). ?include=discarded
//      also shows superseded revisions (grey "已废弃" tag).
export interface ListExamsFilters {
  dept?: string;
  storeId?: string;
  status?: string;
  include?: string;
  daysToReview?: number;
  ageMin?: number;
  ageMax?: number;
}

export async function listExams(prisma: PrismaClient, filters: ListExamsFilters) {
  const { dept, storeId, status, include, daysToReview, ageMin, ageMax } = filters;

  const where: any = { deletedAt: null, voidedAt: null };
  if (include !== 'discarded') where.discardedAt = null;
  if (dept) where.dept = dept;
  if (storeId) where.registeredStoreId = storeId;
  if (status) where.reviewStatus = status;
  // Default: only paid exams. When showing discarded revisions, don't enforce
  // the payment filter — a discarded record may have a payment and should still
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

  return { items: rows };
}

// ---------- Void an unpaid draft (B.6) ----------
// Only exams WITHOUT a payment can be voided. Voiding sets voidedAt, removing the
// draft from all lists/stats without going through the recycle bin.
export async function voidExam(prisma: PrismaClient, id: string) {
  const exam = await prisma.examRecord.findUnique({ where: { id }, include: { payment: true } });
  if (!exam) throw new ExamError('检查记录不存在');
  if (exam.voidedAt) throw new ExamError('该记录已作废');
  if (exam.payment) throw new ExamError('已支付的记录不能作废，如需删除请走回收站');
  const updated = await prisma.examRecord.update({
    where: { id: exam.id },
    data: { voidedAt: new Date() },
  });
  return { ok: true, voidedAt: updated.voidedAt };
}

// ---------- Review status update ----------
export async function updateReviewStatus(prisma: PrismaClient, id: string, input: {
  reviewStatus: string; reviewerId?: string; reviewerName?: string; reviewNote?: string;
}) {
  const { reviewStatus, reviewerId, reviewerName, reviewNote } = input;
  if (!reviewStatus || !['PENDING', 'CONTACTED', 'CONTACTED_NO_SHOW', 'REVIEWED'].includes(reviewStatus)) {
    throw new ExamError('无效复查状态');
  }
  return prisma.examRecord.update({
    where: { id },
    data: { reviewStatus, reviewerId, reviewerName, reviewNote },
  });
}

// ---------- Edit exam (版本化保留：不覆盖旧记录，新增修正版 + 旧记录标记废弃) ----------
// §2.2: editing a (typically paid) exam no longer UPDATEs the original. Instead:
//   1. Mark the old record discardedAt = now (its Payment rows stay attached and
//      are never moved/rewritten — historical receipts are immutable).
//   2. Create a new ExamRecord with the modified values, revisesExamId = old.id,
//      discardedAt = null, createdAt = now. The new record starts UNPAID; if the
//      edit changed amounts, the user runs "继续支付" on the new record to settle
//      the difference (a brand-new Payment row that enters stats normally).
//
// Password verification is the CALLER's responsibility (server: local DB hash;
// electron: round-trip to /api/auth/verify-change). Do not call this without
// verifying first — there is no second check here.
export interface UpdateExamInput {
  dept?: string;
  templateId?: string;
  templateName?: string;
  content?: unknown;
  lensBrand?: string;
  lensPrice?: number;
  frameBrand?: string;
  framePrice?: number;
  totalAmount?: number;
  reviewDate?: string;
  reviewerId?: string;
  reviewerName?: string;
  reviewNote?: string;
  registeredById?: string;
  registeredByName?: string;
  registeredAt?: string;
}

export async function updateExam(prisma: PrismaClient, id: string, input: UpdateExamInput) {
  const exam = await prisma.examRecord.findUnique({ where: { id } });
  if (!exam) throw new ExamError('检查记录不存在');

  const {
    dept, templateId, templateName, content,
    lensBrand, lensPrice, frameBrand, framePrice, totalAmount,
    reviewDate, reviewerId, reviewerName, reviewNote,
    registeredById, registeredByName, registeredAt,
  } = input;

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
  return created;
}
