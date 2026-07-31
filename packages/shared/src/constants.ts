// Domain constants shared across server + client.

export const DEPT = {
  OPTICAL: 'OPTICAL', // 配镜部
  EYE: 'EYE',         // 眼科部
} as const;
export type Dept = typeof DEPT[keyof typeof DEPT];
export const DEPT_LABELS: Record<string, string> = { OPTICAL: '配镜部', EYE: '眼科部' };

export const LEDGER_FIELD = {
  BALANCE: 'BALANCE', // 卡内余额 (cents)
  BEANS: 'BEANS',     // 豆 (count)
  POINTS: 'POINTS',   // 累计积分 (count)
} as const;
export type LedgerField = typeof LEDGER_FIELD[keyof typeof LEDGER_FIELD];

export const LEDGER_SOURCE = {
  INIT: 'INIT',
  RECHARGE: 'RECHARGE',
  CONSUME: 'CONSUME',
  AWARD: 'AWARD',
  EXPIRE: 'EXPIRE',
  ADJUST: 'ADJUST',
} as const;

export const MEMBER_STATUS = { ACTIVE: 'ACTIVE', DELETED: 'DELETED' } as const;
export const REVIEW_STATUS = {
  PENDING: 'PENDING',                       // 待复查
  CONTACTED: 'CONTACTED',                   // 已联系
  CONTACTED_NO_SHOW: 'CONTACTED_NO_SHOW',   // 已联系不到店
  REVIEWED: 'REVIEWED',                     // 已复查
} as const;
export const REVIEW_STATUS_LABELS: Record<string, string> = {
  PENDING: '待复查',
  CONTACTED: '已联系',
  CONTACTED_NO_SHOW: '已联系不到店',
  REVIEWED: '已复查',
};

export const DISCOUNT_TYPE = { PERCENT: 'PERCENT', MINUS: 'MINUS' } as const;

// 100 豆 = 1 元. Since money is in cents (1元=100分), 1 豆 == 1 分 numerically.
export const BEANS_PER_YUAN = 100;     // 100豆/元
export const BEANS_PER_CENT = 1;        // 1豆 = 1分
export const BEAN_REDEEM_MULTIPLE = 100; // 豆抵现必须整百使用
export const CASH_TO_BEAN_RATE = 1;     // 1元现金 = 1豆  => 1分现金 = 1/100豆 (see award calc)

export const DEFAULT_REVIEW_DAYS = 90;
export const RECYCLE_RETENTION_DAYS = 30;
export const MAX_TIERS = 20;
export const MAX_TEMPLATES_PER_DEPT = 10;

// Performance commission tiers (merged across all stores).
export const PERFORMANCE_TIERS = [
  { upToCents: 2_000_000, rate: 0.04 }, // 2万元以内部分 4%
  { upToCents: Infinity, rate: 0.07 }, // 超过2万元部分 7%
] as const;

export const SETTING_KEYS = {
  BEAN_EXPIRY_ENABLED: 'beanExpiry.enabled',
  BEAN_EXPIRY_MONTHS: 'beanExpiry.months',
} as const;

// Format helpers (pure, usable on both sides).
export function formatCents(cents: number | null | undefined): string {
  if (cents === null || cents === undefined || Number.isNaN(cents)) return '0.00';
  const sign = cents < 0 ? '-' : '';
  const abs = Math.abs(Math.round(cents));
  const yuan = Math.floor(abs / 100);
  const fen = abs % 100;
  return `${sign}${yuan}.${fen.toString().padStart(2, '0')}`;
}
export function parseYuanToCents(yuan: string | number): number {
  if (typeof yuan === 'number') return Math.round(yuan * 100);
  const n = parseFloat(yuan);
  if (Number.isNaN(n)) return 0;
  return Math.round(n * 100);
}
export function formatDate(d: Date | string | null | undefined): string {
  if (!d) return '';
  const date = typeof d === 'string' ? new Date(d) : d;
  if (Number.isNaN(date.getTime())) return '';
  const p = (n: number) => n.toString().padStart(2, '0');
  return `${date.getFullYear()}-${p(date.getMonth() + 1)}-${p(date.getDate())}`;
}
export function formatDateTime(d: Date | string | null | undefined): string {
  if (!d) return '';
  const date = typeof d === 'string' ? new Date(d) : d;
  if (Number.isNaN(date.getTime())) return '';
  const p = (n: number) => n.toString().padStart(2, '0');
  return `${date.getFullYear()}-${p(date.getMonth() + 1)}-${p(date.getDate())} ${p(date.getHours())}:${p(date.getMinutes())}:${p(date.getSeconds())}`;
}
