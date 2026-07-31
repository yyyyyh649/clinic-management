// Shared TypeScript types (DTOs + sync payload shapes), not Prisma models.
import type { Dept } from './constants.js';

export interface BalanceSummary {
  balanceCents: number; // 卡内余额 (cents) = sum BALANCE ledger deltas
  beans: number;        // 豆 (count) = sum BEANS ledger deltas
  points: number;       // 累计积分 (count) = sum POINTS ledger deltas
  spendableBeans: number; // 非过期可用豆 = sum of batch.remaining for unexpired batches
}

export interface TierInfo {
  level: number | null;
  name: string;
  minPoints: number;
  reached: boolean;
}

// Device identity (stored locally, registered with server).
export interface DeviceIdentity {
  deviceId: string;
  deviceCode: string;
  storeId: string;
  storeCode: string;
  storeName: string;
  boundAt: string;
}

// Sync record envelope used for push/pull. Tables that participate in sync.
export type SyncTableName =
  | 'Store' | 'Device' | 'Staff' | 'Customer' | 'PhoneHistory'
  | 'TierRule' | 'Setting' | 'Member' | 'Ledger' | 'BeanBatch'
  | 'ExamRecord' | 'Payment' | 'Recharge' | 'ExamTemplate' | 'Brand'
  | 'AnomalyRecord' | 'RecycleBinEntry' | 'AuditLog';

export interface SyncRecord {
  table: SyncTableName;
  id: string;
  data: Record<string, unknown>;
  updatedAt: string;
  deletedAt: string | null;
}

export interface SyncPushRequest {
  deviceId: string;
  deviceCode: string;
  storeId: string;
  records: SyncRecord[];   // pending local changes
}

export interface SyncPushResponse {
  accepted: number;
  rejected: number;
  anomalies: { memberId: string; field: string; value: number }[];
}

export interface SyncPullRequest {
  deviceId: string;
  cursors: Partial<Record<SyncTableName, string>>; // last updatedAt per table
}

export interface SyncPullResponse {
  records: SyncRecord[];
  cursors: Partial<Record<SyncTableName, string>>;
  serverTime: string;
}

// Revenue result shapes
export interface DeptRevenue {
  dept: Dept;
  cashRevenue: number;       // 现金营业额 (cents)
  storedConsume: number;     // 储值消耗 (cents): balance+beans deducted this dept
  storedRevenue: number;     // 储值消耗营业额 (cents, allocated)
  total: number;            // 总营业额 = cash + stored
}
export interface MonthRevenue {
  year: number;
  month: number;
  optical: DeptRevenue;
  eye: DeptRevenue;
  totalCash: number;
  totalStored: number;
  total: number;
  // pools
  rechargeCashInMonth: number;     // 本月新增现金充值
  rechargeStoredInMonth: number;    // 本月新增储值
  poolCashBase: number;            // 分摊基数 (上月结转现金池 + 本月新增)
  poolStoredBase: number;          // 储值池总额 (上月结转储值池 + 本月新增)
  carryCashToNext: number;         // 结转现金池到下月
  carryStoredToNext: number;       // 结转储值池到下月
}

export interface StaffPerformanceRow {
  staffId: string;
  staffName: string;
  opticalConsumeCents: number;   // 配镜部业绩 (实际余额消耗值)
  storeBreakdown: { storeId: string; storeName: string; consume: number }[];
  commissionCents: number;       // 提成 (merged tiered)
  openCount: number;             // 开卡数
}

// Login payload for backend
export interface BackendSession {
  token: string;     // simple opaque token (password-bound)
  issuedAt: number;
}
