// Exam routes (admin SPA). Mounted under requireBackend.
// Uses shared exam-service for CRUD logic (same pattern as payment-service),
// so server and Electron client share ONE implementation.
// ExamError carries its own HTTP status (404 for not-found, 400 for validation/
// business failures), so each catch just forwards e.status — no per-route
// hardcoding that could drift from the service's intent.
import { Router } from 'express';
import { prisma } from '../db.js';
import {
  createExam as createExamSvc, getExamDetail, listExams, voidExam,
  updateReviewStatus, updateExam as updateExamSvc, ExamError,
} from '@clinic/shared';
import { verifyPassword, PASSWORD_KEY } from '../passwords.js';

export const examRouter = Router();

// ---------- List ----------
examRouter.get('/', async (req, res) => {
  const { dept, storeId, status, include } = req.query as Record<string, string>;
  const daysToReview = req.query.daysToReview ? Number(req.query.daysToReview) : undefined;
  const ageMin = req.query.ageMin ? Number(req.query.ageMin) : undefined;
  const ageMax = req.query.ageMax ? Number(req.query.ageMax) : undefined;
  try {
    const result = await listExams(prisma, { dept, storeId, status, include, daysToReview, ageMin, ageMax });
    res.json(result);
  } catch (e: any) {
    if (e instanceof ExamError) return res.status(e.status).json({ error: e.message });
    throw e;
  }
});

// ---------- Detail + customer's full history ----------
examRouter.get('/:id', async (req, res) => {
  try {
    res.json(await getExamDetail(prisma, req.params.id));
  } catch (e: any) {
    if (e instanceof ExamError) return res.status(e.status).json({ error: e.message });
    throw e;
  }
});

// ---------- Create ----------
examRouter.post('/', async (req, res) => {
  try {
    res.json(await createExamSvc(prisma, req.body || {}));
  } catch (e: any) {
    if (e instanceof ExamError) return res.status(e.status).json({ error: e.message });
    throw e;
  }
});

// ---------- Edit exam (版本化保留 §2.2 + 密码同次校验) ----------
// Password verified inline (same request as the write). The shared updateExam
// does the discard-old + create-new write but does NOT check the password —
// that's the caller's job (server uses local DB hash, client round-trips).
examRouter.put('/:id', async (req, res) => {
  const { changePassword: cp, ...rest } = req.body || {};
  const ok = await verifyPassword(prisma, PASSWORD_KEY.CHANGE, cp || '');
  if (!ok) return res.status(403).json({ error: '修改检查单需要敏感信息修改密码验证通过' });
  try {
    res.json(await updateExamSvc(prisma, req.params.id, rest));
  } catch (e: any) {
    if (e instanceof ExamError) return res.status(e.status).json({ error: e.message });
    throw e;
  }
});

// ---------- Review status update ----------
examRouter.put('/:id/review', async (req, res) => {
  try {
    res.json(await updateReviewStatus(prisma, req.params.id, req.body || {}));
  } catch (e: any) {
    if (e instanceof ExamError) return res.status(e.status).json({ error: e.message });
    throw e;
  }
});

// ---------- Void an unpaid draft (B.6) ----------
examRouter.post('/:id/void', async (req, res) => {
  try {
    res.json(await voidExam(prisma, req.params.id));
  } catch (e: any) {
    if (e instanceof ExamError) return res.status(e.status).json({ error: e.message });
    throw e;
  }
});

// ---------- Soft delete (to recycle bin, 30d retention) ----------
// Stays here (not in shared service) — only the admin SPA soft-deletes to the
// recycle bin; the Electron front desk never does this.
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
