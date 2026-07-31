// Tier (档位) calculation from cumulative points.
// Tier is read-only, derived from POINTS. Only manual backend clear-zero resets points.
import type { TierRule } from '../../generated/client';
import type { TierInfo } from '../types.js';

// Sort rules ascending by minPoints; pick highest whose minPoints <= points.
export function computeTier(points: number, rules: TierRule[]): TierInfo {
  if (!rules || rules.length === 0) {
    return { level: null, name: '无档位', minPoints: 0, reached: false };
  }
  const sorted = [...rules].sort((a, b) => a.minPoints - b.minPoints);
  let matched: TierRule | null = null;
  for (const r of sorted) {
    if (points >= r.minPoints) matched = r;
    else break;
  }
  if (!matched) {
    // below the lowest threshold
    return { level: sorted[0].level, name: sorted[0].name, minPoints: sorted[0].minPoints, reached: false };
  }
  return { level: matched.level, name: matched.name, minPoints: matched.minPoints, reached: true };
}

// Next tier above current points (for "距离下一档还需 X 积分").
export function nextTier(points: number, rules: TierRule[]): TierRule | null {
  const sorted = [...rules].sort((a, b) => a.minPoints - b.minPoints);
  return sorted.find((r) => r.minPoints > points) ?? null;
}

// Compute the next clear-zero execution date for a rule, on/after `from`.
// YEAR: clear on clearMonth/clearDay each year. MONTH: clear on clearDay each month.
export function nextClearDate(rule: TierRule, from: Date = new Date()): Date | null {
  if (!rule.clearEnabled) return null;
  const now = new Date(from);
  if (rule.clearPeriod === 'MONTH') {
    const day = rule.clearDay ?? 1;
    let y = now.getFullYear(), m = now.getMonth();
    let candidate = new Date(y, m, day, 0, 0, 0, 0);
    if (candidate <= now) candidate = new Date(y, m + 1, day, 0, 0, 0, 0);
    return candidate;
  }
  if (rule.clearPeriod === 'YEAR') {
    const month = (rule.clearMonth ?? 1) - 1;
    const day = rule.clearDay ?? 1;
    let y = now.getFullYear();
    let candidate = new Date(y, month, day, 0, 0, 0, 0);
    if (candidate <= now) candidate = new Date(y + 1, month, day, 0, 0, 0, 0);
    return candidate;
  }
  return null;
}
