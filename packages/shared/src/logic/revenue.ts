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
// Signed: positive delta (直接赠送) increases the stored pool, negative delta
// (手工调减) decreases it — the pool must match the Ledger's own sum.
export interface BalanceAdjustForRevenue {
  delta: number;       // cents (signed)
  createdAt: Date | string;
}

// Month attribution is pinned to the business timezone (Asia/Shanghai) so a
// store PC and a UTC cloud server bucket the same record into the same month.
const BIZ_TZ = 'Asia/Shanghai';
const monthFmt = new Intl.DateTimeFormat('en-US', { timeZone: BIZ_TZ, year: 'numeric', month: 'numeric' });

function ym(d: Date | string): string {
  const date = typeof d === 'string' ? new Date(d) : d;
  let y = 0, m = 0;
  for (const p of monthFmt.formatToParts(date)) {
    if (p.type === 'year') y = Number(p.value);
    else if (p.type === 'month') m = Number(p.value);
  }
  // zero-padded so keys sort/compare lexicographically
  return `${y}-${String(m).padStart(2, '0')}`;
}

interface MonthBuckets {
  newCash: number;
  newStored: number;
  adjustStored: number;
  opticalStoredConsume: number;
  eyeStoredConsume: number;
  opticalCash: number;
  eyeCash: number;
}

function emptyBuckets(): MonthBuckets {
  return { newCash: 0, newStored: 0, adjustStored: 0, opticalStoredConsume: 0, eyeStoredConsume: 0, opticalCash: 0, eyeCash: 0 };
}

// Single pass over all records, bucketing by business-timezone month.
function bucketize(
  recharges: RechargeForRevenue[],
  payments: PaymentForRevenue[],
  balanceAdjusts: BalanceAdjustForRevenue[],
): Map<string, MonthBuckets> {
  const map = new Map<string, MonthBuckets>();
  const at = (key: string) => {
    let b = map.get(key);
    if (!b) { b = emptyBuckets(); map.set(key, b); }
    return b;
  };
  for (const r of recharges) {
    const b = at(ym(r.createdAt));
    b.newCash += r.cashPaid;
    b.newStored += r.balanceAdded;
  }
  for (const p of payments) {
    const b = at(ym(p.createdAt));
    const stored = p.balanceDeduct + p.beansDeductAmount;
    if (p.dept === 'OPTICAL') { b.opticalStoredConsume += stored; b.opticalCash += p.cashPaid; }
    else { b.eyeStoredConsume += stored; b.eyeCash += p.cashPaid; }
  }
  for (const a of balanceAdjusts) {
    at(ym(a.createdAt)).adjustStored += a.delta;
  }
  return map;
}

function nextMonthKey(key: string): string {
  let [y, m] = key.split('-').map(Number);
  m++; if (m > 12) { m = 1; y++; }
  return `${y}-${String(m).padStart(2, '0')}`;
}

function emptyRow(year: number, month: number): MonthRevenue {
  return {
    year, month,
    optical: { dept: 'OPTICAL', cashRevenue: 0, storedConsume: 0, storedRevenue: 0, total: 0 },
    eye: { dept: 'EYE', cashRevenue: 0, storedConsume: 0, storedRevenue: 0, total: 0 },
    totalCash: 0, totalStored: 0, total: 0,
    rechargeCashInMonth: 0, rechargeStoredInMonth: 0, poolCashBase: 0, poolStoredBase: 0,
    carryCashToNext: 0, carryStoredToNext: 0,
  };
}

// Compute one month given the carry-in from the previous month.
// Allocation rules:
//  - ratio clamped to [0,1]: offline-merge anomalies can make consume exceed the pool;
//  - the second department takes min(own rounded share, remainder) so the two
//    departments never over-allocate the cash pool by a rounding cent;
//  - carry-over is clamped >= 0 so a bad month cannot poison every later month.
function computeMonthFromBuckets(
  key: string,
  b: MonthBuckets,
  carryCash: number,
  carryStored: number,
): { row: MonthRevenue; carryCashNext: number; carryStoredNext: number } {
  const [yy, mm] = key.split('-').map(Number);
  const poolCashBase = Math.max(0, carryCash + b.newCash);
  const poolStoredBase = Math.max(0, carryStored + b.newStored + b.adjustStored);
  const totalStoredConsume = b.opticalStoredConsume + b.eyeStoredConsume;

  let opticalStoredRevenue = 0, eyeStoredRevenue = 0;
  if (poolStoredBase > 0 && totalStoredConsume > 0 && poolCashBase > 0) {
    const ratioOptical = Math.min(1, Math.max(0, b.opticalStoredConsume / poolStoredBase));
    const ratioEye = Math.min(1, Math.max(0, b.eyeStoredConsume / poolStoredBase));
    opticalStoredRevenue = Math.round(ratioOptical * poolCashBase);
    eyeStoredRevenue = Math.min(Math.round(ratioEye * poolCashBase), poolCashBase - opticalStoredRevenue);
  }

  const optical: DeptRevenue = {
    dept: 'OPTICAL',
    cashRevenue: b.opticalCash,
    storedConsume: b.opticalStoredConsume,
    storedRevenue: opticalStoredRevenue,
    total: b.opticalCash + opticalStoredRevenue,
  };
  const eye: DeptRevenue = {
    dept: 'EYE',
    cashRevenue: b.eyeCash,
    storedConsume: b.eyeStoredConsume,
    storedRevenue: eyeStoredRevenue,
    total: b.eyeCash + eyeStoredRevenue,
  };

  const carryCashNext = Math.max(0, poolCashBase - (opticalStoredRevenue + eyeStoredRevenue));
  const carryStoredNext = Math.max(0, poolStoredBase - totalStoredConsume);

  const row: MonthRevenue = {
    year: yy, month: mm,
    optical, eye,
    totalCash: b.opticalCash + b.eyeCash,
    totalStored: totalStoredConsume,
    total: optical.total + eye.total,
    rechargeCashInMonth: b.newCash,
    rechargeStoredInMonth: b.newStored + b.adjustStored,
    poolCashBase, poolStoredBase,
    carryCashToNext: carryCashNext,
    carryStoredToNext: carryStoredNext,
  };
  return { row, carryCashNext, carryStoredNext };
}

// Compute a single month's revenue breakdown given rolling carry from previous month.
export function computeRevenue(
  recharges: RechargeForRevenue[],
  payments: PaymentForRevenue[],
  year: number,
  month: number,
  balanceAdjusts: BalanceAdjustForRevenue[] = [],
): MonthRevenue {
  const buckets = bucketize(recharges, payments, balanceAdjusts);
  const target = `${year}-${String(month).padStart(2, '0')}`;
  const keys = [...buckets.keys()].sort();
  const start = keys.length && keys[0] < target ? keys[0] : target;

  let carryCash = 0, carryStored = 0, result: MonthRevenue | null = null;
  for (let key = start; ; key = nextMonthKey(key)) {
    const { row, carryCashNext, carryStoredNext } = computeMonthFromBuckets(key, buckets.get(key) ?? emptyBuckets(), carryCash, carryStored);
    if (key === target) { result = row; break; }
    carryCash = carryCashNext;
    carryStored = carryStoredNext;
  }
  return result ?? emptyRow(year, month);
}

// Series for charts: Jan..Dec of `year`, carrying 结转 from the earliest record.
// One bucketization + one walk (was O(12 × months × records)).
export function computeRevenueSeries(
  recharges: RechargeForRevenue[],
  payments: PaymentForRevenue[],
  year: number,
  balanceAdjusts: BalanceAdjustForRevenue[] = [],
): MonthRevenue[] {
  const buckets = bucketize(recharges, payments, balanceAdjusts);
  const end = `${year}-12`;
  const keys = [...buckets.keys()].sort();
  const start = keys.length && keys[0] < `${year}-01` ? keys[0] : `${year}-01`;

  const out: MonthRevenue[] = [];
  let carryCash = 0, carryStored = 0;
  for (let key = start; ; key = nextMonthKey(key)) {
    const { row, carryCashNext, carryStoredNext } = computeMonthFromBuckets(key, buckets.get(key) ?? emptyBuckets(), carryCash, carryStored);
    if (row.year === year) out.push(row);
    carryCash = carryCashNext;
    carryStored = carryStoredNext;
    if (key === end) break;
  }
  return out;
}
