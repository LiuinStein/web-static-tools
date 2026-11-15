import Decimal from 'decimal.js';

export const TIMING_THRESHOLD_STORAGE_KEY = 'monthly-review:return-timing-threshold:v1';
export const DEFAULT_TIMING_THRESHOLD = 1;
export const validTimingThreshold = (value: unknown): value is number => typeof value === 'number' && Number.isFinite(value) && value >= 0;
export function parseTimingThreshold(text: string | null): number {
  try { const value = JSON.parse(text || 'null'); return validTimingThreshold(value) ? value : DEFAULT_TIMING_THRESHOLD; }
  catch { return DEFAULT_TIMING_THRESHOLD; }
}
function timingDirection(xirr: unknown, twr: unknown, threshold: number): 'drag' | 'better' | undefined {
  if (![xirr, twr].every(value => typeof value === 'number' && Number.isFinite(value)) || !validTimingThreshold(threshold)) return undefined;
  const difference = new Decimal(twr as number).minus(xirr as number).times(100);
  if (difference.gt(threshold)) return 'drag';
  if (difference.negated().gt(threshold)) return 'better';
  return undefined;
}
export function returnTimingHint(xirr: unknown, twr: unknown, threshold = DEFAULT_TIMING_THRESHOLD): string | undefined {
  const direction = timingDirection(xirr, twr, threshold);
  return direction === 'drag' ? '追涨杀跌？操作时机正在拖累实际收益' : direction === 'better' ? '产品表现一般，但操作时机较好' : undefined;
}
export function returnTimingRisk(xirr: unknown, twr: unknown, threshold = DEFAULT_TIMING_THRESHOLD): 'drag' | 'better' | undefined {
  if (!((typeof xirr === 'number' && xirr < 0) || (typeof twr === 'number' && twr < 0))) return undefined;
  return timingDirection(xirr, twr, threshold);
}
