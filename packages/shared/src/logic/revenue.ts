// Revenue computation with rolling pool carry-over (结转) per spec §6.2.
// Pure function: caller passes pre-filtered (by store) recharges + payments with dept attached.
import type { DeptRevenue, MonthRevenue } from '../types.js';

export interface RechargeForRevenue {
  cashPaid: number;     // cents
  balanceAdded: number; // cents
  createdAt: Date | string;
}
export interface PaymentForRevenue {
  dept: 'OPTICAL' | 'EYE';
  cashPaid: number;        // cents (actual cash after balance/bean deduction)
  balanceDeduct: number;  // cents
  beansDeductAmount: number; // cents (== beansDeduct count)
  createdAt: Date | string;
}
// Manual balance adjustments via Ledger (source=ADJUST, field=BALANCE).
// Positive delta with no Recharge row (e.g. 直接赠送) still increases the
// stored pool — otherwise the stored pool would undercount manual edits.
export interface BalanceAdjustForRevenue {
  delta: number;       // cents (signed)
  createdAt: Date | string;
}

function ym(d: Date | string): string {
  const date = typeof d === 'string' ? new Date(d) : d;
  return `${date.getFullYear()}-${date.getMonth() + 1}`;
}

// List of "YYYY-M" month keys from earliest record month up to target (inclusive).
function monthRange(recharges: RechargeForRevenue[], payments: PaymentForRevenue[], year: number, month: number): string[] {
  const all = [...recharges.map((r) => r.createdAt), ...payments.map((p) => p.createdAt)];
  if (all.length === 0) return [`${year}-${month}`];
  let minDate = new Date(all[0]);
  for (const d of all) {
    const dd = typeof d === 'string' ? new Date(d) : d;
    if (dd < minDate) minDate = dd;
  }
  const keys: string[] = [];
  let y = minDate.getFullYear(), m = minDate.getMonth() + 1;
  while (y < year || (y === year && m <= month)) {
    keys.push(`${y}-${m}`);
    m++; if (m > 12) { m = 1; y++; }
  }
  return keys;
}

// Compute a single month's revenue breakdown given rolling carry from previous month.
export function computeRevenue(
  recharges: RechargeForRevenue[],
  payments: PaymentForRevenue[],
  year: number,
  month: number,
  balanceAdjusts: BalanceAdjustForRevenue[] = [],
): MonthRevenue {
  const range = monthRange(recharges, payments, year, month);
  let carryCash = 0;
  let carryStored = 0;
  let result: MonthRevenue | null = null;

  for (const key of range) {
    const [yy, mm] = key.split('-').map(Number);
    const newCash = recharges.filter((r) => ym(r.createdAt) === key).reduce((s, r) => s + r.cashPaid, 0);
    const newStored = recharges.filter((r) => ym(r.createdAt) === key).reduce((s, r) => s + r.balanceAdded, 0);
    // Manual balance adjustments (Ledger ADJUST): positive delta adds to stored pool.
    const adjustStored = balanceAdjusts.filter((a) => ym(a.createdAt) === key).reduce((s, a) => s + a.delta, 0);

    const poolCashBase = carryCash + newCash;
    const poolStoredBase = carryStored + newStored + Math.max(0, adjustStored);

    const monthPayments = payments.filter((p) => ym(p.createdAt) === key);
    const opticalStoredConsume = monthPayments.filter((p) => p.dept === 'OPTICAL').reduce((s, p) => s + p.balanceDeduct + p.beansDeductAmount, 0);
    const eyeStoredConsume = monthPayments.filter((p) => p.dept === 'EYE').reduce((s, p) => s + p.balanceDeduct + p.beansDeductAmount, 0);
    const totalStoredConsume = opticalStoredConsume + eyeStoredConsume;

    let opticalStoredRevenue = 0, eyeStoredRevenue = 0;
    if (poolStoredBase > 0 && totalStoredConsume > 0) {
      const ratioOptical = opticalStoredConsume / poolStoredBase;
      const ratioEye = eyeStoredConsume / poolStoredBase;
      opticalStoredRevenue = Math.round(ratioOptical * poolCashBase);
      eyeStoredRevenue = Math.round(ratioEye * poolCashBase);
    }

    const opticalCash = monthPayments.filter((p) => p.dept === 'OPTICAL').reduce((s, p) => s + p.cashPaid, 0);
    const eyeCash = monthPayments.filter((p) => p.dept === 'EYE').reduce((s, p) => s + p.cashPaid, 0);

    const optical: DeptRevenue = {
      dept: 'OPTICAL',
      cashRevenue: opticalCash,
      storedConsume: opticalStoredConsume,
      storedRevenue: opticalStoredRevenue,
      total: opticalCash + opticalStoredRevenue,
    };
    const eye: DeptRevenue = {
      dept: 'EYE',
      cashRevenue: eyeCash,
      storedConsume: eyeStoredConsume,
      storedRevenue: eyeStoredRevenue,
      total: eyeCash + eyeStoredRevenue,
    };

    const carryCashNext = poolCashBase - (opticalStoredRevenue + eyeStoredRevenue);
    const carryStoredNext = poolStoredBase - (opticalStoredConsume + eyeStoredConsume);

    const row: MonthRevenue = {
      year: yy, month: mm,
      optical, eye,
      totalCash: opticalCash + eyeCash,
      totalStored: opticalStoredConsume + eyeStoredConsume,
      total: optical.total + eye.total,
      rechargeCashInMonth: newCash,
      rechargeStoredInMonth: newStored,
      poolCashBase, poolStoredBase,
      carryCashToNext: carryCashNext,
      carryStoredToNext: carryStoredNext,
    };

    if (key === `${year}-${month}`) result = row;
    carryCash = carryCashNext;
    carryStored = carryStoredNext;
  }

  return result ?? {
    year, month,
    optical: { dept: 'OPTICAL', cashRevenue: 0, storedConsume: 0, storedRevenue: 0, total: 0 },
    eye: { dept: 'EYE', cashRevenue: 0, storedConsume: 0, storedRevenue: 0, total: 0 },
    totalCash: 0, totalStored: 0, total: 0,
    rechargeCashInMonth: 0, rechargeStoredInMonth: 0, poolCashBase: 0, poolStoredBase: 0,
    carryCashToNext: 0, carryStoredToNext: 0,
  };
}

// Series for charts: compute each month Jan..Dec (or a range) carrying结转.
export function computeRevenueSeries(
  recharges: RechargeForRevenue[],
  payments: PaymentForRevenue[],
  year: number,
  balanceAdjusts: BalanceAdjustForRevenue[] = [],
): MonthRevenue[] {
  const out: MonthRevenue[] = [];
  for (let month = 1; month <= 12; month++) {
    out.push(computeRevenue(recharges, payments, year, month, balanceAdjusts));
  }
  return out;
}
