import Decimal from 'decimal.js';
import { normalizeProductCategory } from './categories';
export type BenchmarkMetric = 'none' | 'xirr' | 'twr';
export interface Benchmark { metric: BenchmarkMetric; high: number; middle: number; low: number; }
export type Benchmarks = Record<string, Benchmark>;
export const BENCHMARK_STORAGE_KEY = 'monthly-review:benchmarks:v1';
export const DEFAULT_BENCHMARKS: Benchmarks = {
  'Time Deposit': { metric: 'none', high: 20, middle: 10, low: 5 },
  'Stock': { metric: 'xirr', high: 20, middle: 10, low: 5 },
  'Current Account': { metric: 'none', high: 20, middle: 10, low: 5 },
  'Equity Fund': { metric: 'xirr', high: 20, middle: 10, low: 5 },
  'Debt Fund': { metric: 'xirr', high: 5, middle: 3, low: 2 },
};
export function benchmarkFor(config: Benchmarks, category: string): Benchmark {
  const key = normalizeProductCategory(category);
  return config[key] || DEFAULT_BENCHMARKS[key] || { metric: 'none', high: 20, middle: 10, low: 5 };
}
export function validBenchmark(value: unknown): value is Benchmark {
  if (!value || typeof value !== 'object') return false;
  const v = value as Benchmark;
  return ['none', 'xirr', 'twr'].includes(v.metric) &&
    [v.high, v.middle, v.low].every(n => typeof n === 'number' && Number.isFinite(n)) &&
    v.high > v.middle && v.middle > v.low;
}
export function parseBenchmarks(text: string | null): Benchmarks {
  const result = JSON.parse(JSON.stringify(DEFAULT_BENCHMARKS)) as Benchmarks;
  try {
    const saved = JSON.parse(text || 'null');
    if (saved && typeof saved === 'object' && !Array.isArray(saved)) {
      for (const key of Object.keys(saved)) if (validBenchmark(saved[key])) result[normalizeProductCategory(key)] = { ...saved[key] };
    }
  } catch { /* Fall back to defaults when local configuration is unreadable. */ }
  return result;
}
export const BENCHMARK_BANDS = ['high', 'middle', 'low', 'below'] as const;
export type BenchmarkBand = typeof BENCHMARK_BANDS[number];
export function benchmarkIntervalLabel(band: BenchmarkBand, metric = 'XIRR（或年化 TWR）'): string {
  return { high: metric + ' ≥ 高档', middle: '中档 ≤ ' + metric + ' < 高档', low: '低档 ≤ ' + metric + ' < 中档', below: metric + '＜低档' }[band];
}
export function benchmarkBand(config: Benchmarks | undefined, category: string, metric: 'xirr' | 'twr', value: unknown): BenchmarkBand | undefined {
  if (!config || typeof value !== 'number' || !Number.isFinite(value)) return undefined;
  const benchmark = benchmarkFor(config, category);
  if (benchmark.metric !== metric) return undefined;
  const percentage = new Decimal(value).times(100);
  return percentage.greaterThanOrEqualTo(benchmark.high) ? 'high' : percentage.greaterThanOrEqualTo(benchmark.middle) ? 'middle' : percentage.greaterThanOrEqualTo(benchmark.low) ? 'low' : 'below';
}
export function matchesBenchmarkBand(config: Benchmarks, category: string, xirr: unknown, twr: unknown, band: BenchmarkBand | 'all'): boolean {
  if (band === 'all') return true;
  const rule = benchmarkFor(config, category);
  return rule.metric !== 'none' && benchmarkBand(config, category, rule.metric, rule.metric === 'xirr' ? xirr : twr) === band;
}
export function benchmarkRating(config: Benchmarks | undefined, category: string, metric: 'xirr' | 'twr', value: unknown): { className?: string; title?: string } {
  const tier = benchmarkBand(config, category, metric, value);
  if (!tier || !config) return {};
  const benchmark = benchmarkFor(config, category);
  return { className: 'mr-performance-' + tier, title: benchmarkIntervalLabel(tier, metric === 'xirr' ? 'XIRR' : '年化 TWR') + '（高档 ' + benchmark.high + '% / 中档 ' + benchmark.middle + '% / 低档 ' + benchmark.low + '%）' };
}
