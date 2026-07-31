// Payment + Recharge routes (admin SPA). Uses shared payment-service for identical logic.
import { Router } from 'express';
import { prisma } from '../db.js';
import { executePayment, executeRecharge, PaymentError } from '@clinic/shared';
import { loadBeanExpirySetting } from './members.js';

export const paymentRouter = Router();

// Create payment for an existing exam.
paymentRouter.post('/', async (req, res) => {
  try {
    const setting = await loadBeanExpirySetting();
    const result = await executePayment(prisma, { ...req.body, beanExpiry: setting });
    const { recomputeAnomalies } = await import('../anomaly.js');
    await recomputeAnomalies([req.body.payForMemberId, req.body.awardMemberId].filter(Boolean) as string[]);
    res.json(result);
  } catch (e: any) {
    if (e instanceof PaymentError) return res.status(400).json({ error: e.message });
    throw e;
  }
});

// Recharge a member card.
paymentRouter.post('/recharge', async (req, res) => {
  try {
    const setting = await loadBeanExpirySetting();
    const result = await executeRecharge(prisma, { ...req.body, beanExpiry: setting });
    res.json(result);
  } catch (e: any) {
    if (e instanceof PaymentError) return res.status(400).json({ error: e.message });
    throw e;
  }
});

// Get a payment by id.
paymentRouter.get('/:id', async (req, res) => {
  const p = await prisma.payment.findUnique({ where: { id: req.params.id }, include: { exam: true } });
  if (!p) return res.status(404).json({ error: '支付记录不存在' });
  res.json(p);
});
