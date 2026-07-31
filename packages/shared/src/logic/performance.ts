// Staff performance: 配镜部业绩 by 实际余额消耗值, tiered commission merged across all stores.
import { PERFORMANCE_TIERS } from '../constants.js';
import type { StaffPerformanceRow } from '../types.js';

export interface PerfRaw {
  staffId: string;
  staffName: string;
  storeId: string;
  storeName: string;
  // 配镜部业绩 = 实际余额消耗值 = balance consumed + beans consumed (cents) by this staff's optical payments
  consumeCents: number;
}

// Tiered commission on MERGED total (not per-store).
//   <=2万元部分 4%, >2万元部分 7%
export function commissionForMerged(totalCents: number): number {
  let commission = 0;
  let remaining = totalCents;
  for (const tier of PERFORMANCE_TIERS) {
    const cap = tier.upToCents;
    const slice = Math.min(remaining, cap);
    if (slice <= 0) break;
    commission += Math.round(slice * tier.rate);
    remaining -= slice;
  }
  return commission;
}

// Aggregate raw rows into per-staff performance with store breakdown.
export function aggregatePerformance(rows: PerfRaw[]): StaffPerformanceRow[] {
  const map = new Map<string, StaffPerformanceRow>();
  const stores = new Map<string, Map<string, { storeId: string; storeName: string; consume: number }>>();
  const openCount = new Map<string, number>(); // filled by caller via separate call
  for (const r of rows) {
    let s = map.get(r.staffId);
    if (!s) {
      s = { staffId: r.staffId, staffName: r.staffName, opticalConsumeCents: 0, storeBreakdown: [], commissionCents: 0, openCount: 0 };
      map.set(r.staffId, s);
    }
    s.opticalConsumeCents += r.consumeCents;
    let sMap = stores.get(r.staffId);
    if (!sMap) { sMap = new Map(); stores.set(r.staffId, sMap); }
    let br = sMap.get(r.storeId);
    if (!br) { br = { storeId: r.storeId, storeName: r.storeName, consume: 0 }; sMap.set(r.storeId, br); }
    br.consume += r.consumeCents;
  }
  for (const [staffId, s] of map) {
    s.commissionCents = commissionForMerged(s.opticalConsumeCents);
    s.storeBreakdown = [...(stores.get(staffId)!.values())];
  }
  return [...map.values()];
}
