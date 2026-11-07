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
export function benchmarkRating(config: Benchmarks | undefined, category: string, metric: 'xirr' | 'twr', value: unknown): { className?: string; title?: string } {
  if (!config || typeof value !== 'number' || !Number.isFinite(value)) return {};
  const benchmark = benchmarkFor(config, category);
  if (benchmark.metric !== metric) return {};
  const percentage = new Decimal(value).times(100);
  const tier = percentage.greaterThanOrEqualTo(benchmark.high) ? 'high' : percentage.greaterThanOrEqualTo(benchmark.middle) ? 'middle' : percentage.greaterThanOrEqualTo(benchmark.low) ? 'low' : 'below';
  const labels = { high: '达到高档', middle: '达到中档，低于高档', low: '达到低档，低于中档', below: '低于低档' };
  return { className: 'mr-performance-' + tier, title: labels[tier] + '（高 ' + benchmark.high + '% / 中 ' + benchmark.middle + '% / 低 ' + benchmark.low + '%）' };
}
