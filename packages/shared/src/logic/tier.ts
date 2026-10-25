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

// Clamp a day-of-month to the actual month length (clearDay=31 in February
// would otherwise roll into March 3 and drift further each month).
function clampDay(year: number, monthIdx: number, day: number): Date {
  const daysInMonth = new Date(year, monthIdx + 1, 0).getDate();
  return new Date(year, monthIdx, Math.min(day, daysInMonth), 0, 0, 0, 0);
}

// Compute the next clear-zero execution date for a rule, on/after `from`.
// YEAR: clear on clearMonth/clearDay each year. MONTH: clear on clearDay each month.
export function nextClearDate(rule: TierRule, from: Date = new Date()): Date | null {
  if (!rule.clearEnabled) return null;
  const now = new Date(from);
  if (rule.clearPeriod === 'MONTH') {
    const day = rule.clearDay ?? 1;
    let y = now.getFullYear(), m = now.getMonth();
    let candidate = clampDay(y, m, day);
    if (candidate <= now) candidate = clampDay(m === 11 ? y + 1 : y, (m + 1) % 12, day);
    return candidate;
  }
  if (rule.clearPeriod === 'YEAR') {
    const month = (rule.clearMonth ?? 1) - 1;
    const day = rule.clearDay ?? 1;
    let y = now.getFullYear();
    let candidate = clampDay(y, month, day);
    if (candidate <= now) candidate = clampDay(y + 1, month, day);
    return candidate;
  }
  return null;
}
