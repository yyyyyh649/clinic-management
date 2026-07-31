// Payment + Recharge execution (spec §4). Shared by client (local) and server (admin).
// All money in cents; beans/points are counts. 1豆 == 1分 (100豆=1元).
import type { PrismaClient } from '../generated/client/index.js';
import { v4 as uuid } from 'uuid';
import {
  LEDGER_FIELD, LEDGER_SOURCE, DISCOUNT_TYPE, BEAN_REDEEM_MULTIPLE,
} from './constants.js';
import { computeBatchExpiry, selectFIFOConsume, type BeanExpirySetting } from './logic/beans.js';

export interface PaymentInput {
  examId: string;
  // discount
  discountType?: 'PERCENT' | 'MINUS';
  discountValue?: number; // 85 => 85折; 5000 => 立减50元(5000分)
  // deductions
  balanceDeductCents: number;   // 卡内余额抵扣
  beansDeductCount: number;     // 豆抵扣数量 (must be multiple of 100)
  payForMemberId?: string;      // 代付: source member (default = exam customer's own member)
  // cash
  cashPaidCents: number;        // 实付现金
  cashPaidEdited: boolean;
  editReason?: string;
  // awards (manual editable, no reason needed)
  beansAwardedOverride?: number;  // default = cashPaidCents / 100 (1元=1豆)
  pointsAwardedOverride?: number; // default = beansAwarded
  awardMemberId?: string;         // 归属 (default = operator's own member)
  // operator / provenance
  operatorId: string;
  operatorName: string;
  operatorMemberId?: string;      // if operator is a member
  storeId: string;
  storeName: string;
  deviceId: string;
  beanExpiry: BeanExpirySetting;
}

export interface PaymentResult {
  paymentId: string;
  baseAmount: number;
  afterDiscount: number;
  expectedCashPaid: number;
  beansAwarded: number;
  pointsAwarded: number;
  ledgers: string[];
}

export class PaymentError extends Error {}

export async function executePayment(prisma: PrismaClient, input: PaymentInput): Promise<PaymentResult> {
  const exam = await prisma.examRecord.findUnique({ where: { id: input.examId }, include: { customer: true } });
  if (!exam) throw new PaymentError('检查记录不存在');
  if (exam.payment) throw new PaymentError('该检查记录已支付');

  // 1. base amount
  let baseAmount = 0;
  if (exam.dept === 'OPTICAL') baseAmount = (exam.lensPrice ?? 0) + (exam.framePrice ?? 0);
  else baseAmount = exam.totalAmount ?? 0;

  // 2. after discount
  let afterDiscount = baseAmount;
  if (input.discountType === DISCOUNT_TYPE.PERCENT && input.discountValue != null) {
    afterDiscount = Math.round((baseAmount * input.discountValue) / 100);
  } else if (input.discountType === DISCOUNT_TYPE.MINUS && input.discountValue != null) {
    afterDiscount = Math.max(0, baseAmount - input.discountValue);
  }

  // 3. beans must be multiple of 100
  if (input.beansDeductCount % BEAN_REDEEM_MULTIPLE !== 0) {
    throw new PaymentError('豆抵现必须整百使用');
  }
  const beansDeductAmount = input.beansDeductCount; // 1豆=1分
  const balanceDeduct = Math.max(0, input.balanceDeductCents);

  // 4. source member for balance/beans
  let sourceMemberId = input.payForMemberId || (exam.customer?.isMember ? exam.customer?.memberId : null) || null;
  if ((balanceDeduct > 0 || input.beansDeductCount > 0) && !sourceMemberId) {
    throw new PaymentError('使用余额/豆抵扣需要指定会员（本客户为会员或选择代付会员）');
  }

  // 5. expected cash
  const expectedCashPaid = Math.max(0, afterDiscount - balanceDeduct - beansDeductAmount);
  const cashPaid = input.cashPaidCents;
  if (cashPaid !== expectedCashPaid) {
    if (!input.cashPaidEdited || !input.editReason || !input.editReason.trim()) {
      throw new PaymentError('实付金额与系统计算不一致，必须填写修改原因');
    }
  }

  // 6. awards
  const beansAwarded = input.beansAwardedOverride ?? Math.floor(cashPaid / 100); // 1元=1豆
  const pointsAwarded = input.pointsAwardedOverride ?? beansAwarded;

  // 7. award target
  let awardMemberId = input.awardMemberId || (input.operatorMemberId ? input.operatorMemberId : null);
  if (beansAwarded > 0 && !awardMemberId) {
    throw new PaymentError('操作人不是会员，无法将豆/积分归属本人，请选择归属会员');
  }

  const paymentId = uuid();
  const ledgerIds: string[] = [];
  const setting = input.beanExpiry;

  await prisma.$transaction(async (tx) => {
    // a. balance consume
    if (balanceDeduct > 0 && sourceMemberId) {
      const lid = uuid();
      ledgerIds.push(lid);
      await tx.ledger.create({
        data: {
          id: lid, memberId: sourceMemberId, field: LEDGER_FIELD.BALANCE, delta: -balanceDeduct,
          source: LEDGER_SOURCE.CONSUME, reason: `消费抵扣（检查 ${exam.id}）`, refType: 'PAYMENT', refId: paymentId,
          operatorId: input.operatorId, operatorName: input.operatorName,
          storeId: input.storeId, storeName: input.storeName, deviceId: input.deviceId,
        },
      });
    }
    // b. beans consume (FIFO)
    if (input.beansDeductCount > 0 && sourceMemberId) {
      const batches = await tx.beanBatch.findMany({ where: { memberId: sourceMemberId } });
      const plan = selectFIFOConsume(batches as any, input.beansDeductCount);
      let left = input.beansDeductCount;
      for (const p of plan) {
        const take = Math.min(left, p.consume);
        await tx.beanBatch.update({ where: { id: p.batchId }, data: { remaining: { decrement: take } } });
        const lid = uuid();
        ledgerIds.push(lid);
        await tx.ledger.create({
          data: {
            id: lid, memberId: sourceMemberId, field: LEDGER_FIELD.BEANS, delta: -take,
            source: LEDGER_SOURCE.CONSUME, reason: `豆抵扣（检查 ${exam.id}）`, refType: 'PAYMENT', refId: paymentId, beanBatchId: p.batchId,
            operatorId: input.operatorId, operatorName: input.operatorName,
            storeId: input.storeId, storeName: input.storeName, deviceId: input.deviceId,
          },
        });
        left -= take;
      }
      if (left > 0) throw new PaymentError('可用豆不足');
    }
    // c. payment record
    const srcMember = sourceMemberId ? await tx.member.findUnique({ where: { id: sourceMemberId }, include: { customer: true } }) : null;
    const awardMember = awardMemberId ? await tx.member.findUnique({ where: { id: awardMemberId }, include: { customer: true } }) : null;
    await tx.payment.create({
      data: {
        id: paymentId, examId: exam.id,
        baseAmount, discountType: input.discountType || null, discountValue: input.discountValue ?? null,
        afterDiscount, balanceDeduct, beansDeduct: input.beansDeductCount, beansDeductAmount,
        cashPaid, cashPaidEdited: input.cashPaidEdited, editReason: input.editReason || null,
        beansAwarded, pointsAwarded,
        payForMemberId: sourceMemberId, payForMemberName: srcMember?.customer?.name, payForMemberCardNo: srcMember?.cardNo,
        awardMemberId: awardMemberId, awardMemberName: awardMember?.customer?.name,
        operatorId: input.operatorId, operatorName: input.operatorName,
        storeId: input.storeId, storeName: input.storeName, deviceId: input.deviceId,
        createdAt: new Date(), updatedAt: new Date(),
      },
    });
    // d. awards: beans batch + BEANS ledger + POINTS ledger (on award member)
    if (beansAwarded > 0 && awardMemberId) {
      const batchId = uuid();
      await tx.beanBatch.create({
        data: { id: batchId, memberId: awardMemberId, remaining: beansAwarded, total: beansAwarded, expiresAt: computeBatchExpiry(new Date(), setting), source: 'AWARD', refId: paymentId },
      });
      const lidB = uuid(); ledgerIds.push(lidB);
      await tx.ledger.create({
        data: {
          id: lidB, memberId: awardMemberId, field: LEDGER_FIELD.BEANS, delta: beansAwarded,
          source: LEDGER_SOURCE.AWARD, reason: `现金消费获得豆（检查 ${exam.id}）`, refType: 'PAYMENT', refId: paymentId, beanBatchId: batchId,
          operatorId: input.operatorId, operatorName: input.operatorName,
          storeId: input.storeId, storeName: input.storeName, deviceId: input.deviceId,
        },
      });
    }
    if (pointsAwarded > 0 && awardMemberId) {
      const lidP = uuid(); ledgerIds.push(lidP);
      await tx.ledger.create({
        data: {
          id: lidP, memberId: awardMemberId, field: LEDGER_FIELD.POINTS, delta: pointsAwarded,
          source: LEDGER_SOURCE.AWARD, reason: `现金消费获得累计积分（检查 ${exam.id}）`, refType: 'PAYMENT', refId: paymentId,
          operatorId: input.operatorId, operatorName: input.operatorName,
          storeId: input.storeId, storeName: input.storeName, deviceId: input.deviceId,
        },
      });
    }
  });

  return { paymentId, baseAmount, afterDiscount, expectedCashPaid, beansAwarded, pointsAwarded, ledgers: ledgerIds };
}

// ---------- Recharge ----------
export interface RechargeInput {
  memberId: string;
  cashPaidCents: number;     // actual cash received -> 现金池
  balanceAddedCents: number; // added to card -> 储值池 (>= cashPaid if bonus)
  beansGifted?: number;
  pointsGifted?: number;
  note?: string;
  operatorId: string;
  operatorName: string;
  storeId: string;
  storeName: string;
  deviceId: string;
  beanExpiry: BeanExpirySetting;
}

export async function executeRecharge(prisma: PrismaClient, input: RechargeInput) {
  const member = await prisma.member.findUnique({ where: { id: input.memberId }, include: { customer: true } });
  if (!member) throw new PaymentError('会员不存在');
  const rechargeId = uuid();
  const setting = input.beanExpiry;

  await prisma.$transaction(async (tx) => {
    await tx.recharge.create({
      data: {
        id: rechargeId, memberId: input.memberId, cardNo: member.cardNo,
        cashPaid: input.cashPaidCents, balanceAdded: input.balanceAddedCents,
        beansGifted: input.beansGifted ?? 0, pointsGifted: input.pointsGifted ?? 0, note: input.note,
        operatorId: input.operatorId, operatorName: input.operatorName,
        storeId: input.storeId, storeName: input.storeName, deviceId: input.deviceId,
      },
    });
    // balance ledger
    if (input.balanceAddedCents > 0) {
      await tx.ledger.create({
        data: {
          id: uuid(), memberId: input.memberId, field: LEDGER_FIELD.BALANCE, delta: input.balanceAddedCents,
          source: LEDGER_SOURCE.RECHARGE, reason: `充值 ${input.balanceAddedCents / 100} 元`, refType: 'RECHARGE', refId: rechargeId,
          operatorId: input.operatorId, operatorName: input.operatorName,
          storeId: input.storeId, storeName: input.storeName, deviceId: input.deviceId,
        },
      });
    }
    // beans gift
    if ((input.beansGifted ?? 0) > 0) {
      const batchId = uuid();
      await tx.beanBatch.create({
        data: { id: batchId, memberId: input.memberId, remaining: input.beansGifted!, total: input.beansGifted!, expiresAt: computeBatchExpiry(new Date(), setting), source: 'RECHARGE_GIFT', refId: rechargeId },
      });
      await tx.ledger.create({
        data: {
          id: uuid(), memberId: input.memberId, field: LEDGER_FIELD.BEANS, delta: input.beansGifted!,
          source: LEDGER_SOURCE.RECHARGE, reason: '充值赠送豆', refType: 'RECHARGE', refId: rechargeId, beanBatchId: batchId,
          operatorId: input.operatorId, operatorName: input.operatorName,
          storeId: input.storeId, storeName: input.storeName, deviceId: input.deviceId,
        },
      });
    }
    // points gift
    if ((input.pointsGifted ?? 0) > 0) {
      await tx.ledger.create({
        data: {
          id: uuid(), memberId: input.memberId, field: LEDGER_FIELD.POINTS, delta: input.pointsGifted!,
          source: LEDGER_SOURCE.RECHARGE, reason: '充值赠送累计积分', refType: 'RECHARGE', refId: rechargeId,
          operatorId: input.operatorId, operatorName: input.operatorName,
          storeId: input.storeId, storeName: input.storeName, deviceId: input.deviceId,
        },
      });
    }
  });

  return { rechargeId };
}
