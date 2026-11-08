import Decimal from 'decimal.js';
import type { MonthlyWorkbook, Product } from './workbook';
import { benchmarkBand, benchmarkFor, Benchmarks, BenchmarkBand } from './benchmarks';
import { sumAvailableAmounts } from './totals';

export type ReturnMetric = 'xirr' | 'twr';
export type ReturnRange = 'high' | 'middle' | 'low' | 'base' | 'negative' | 'missing';
export type BenchmarkBucket = BenchmarkBand | 'unconfigured' | 'missing';
export interface ReturnRow { id: string; product: Product; xirr: number | null; twr: number | null; balanceRmb: number | null; }
const finite = (value: unknown): number | null => typeof value === 'number' && Number.isFinite(value) ? value : null;
export function returnRows(book: MonthlyWorkbook, products: Product[], invalidKeys: string[] = []): ReturnRow[] {
  const invalid = new Set(invalidKeys);
  return products.map(product => {
    const id = product.sheet + ':' + product.row, valid = !invalid.has(id);
    const rate = book.exchangeRate(product.currency);
    const amount = valid && Number.isFinite(product.balance) && product.balance >= 0 && Number.isFinite(rate) && rate > 0
      ? finite(new Decimal(product.balance).times(rate).toNumber()) : null;
    return { id, product, xirr: valid ? finite(book.value(product.sheet, 'K' + product.row)) : null,
      twr: valid ? finite(book.value(product.sheet, 'L' + product.row)) : null, balanceRmb: amount };
  });
}
export function median(values: Array<number | null>): number | null {
  const sorted = values.filter((value): value is number => finite(value) !== null).sort((a, b) => a - b);
  const size = sorted.length;
  return !size ? null : size % 2 ? sorted[(size - 1) / 2] : new Decimal(sorted[size / 2 - 1]).plus(sorted[size / 2]).div(2).toNumber();
}
export function returnSummary(rows: ReturnRow[], metric: ReturnMetric) {
  const rates = rows.map(row => row[metric]).filter((value): value is number => value !== null);
  return { count: rows.length, valid: rates.length, missing: rows.length - rates.length,
    positive: rates.filter(value => value > 0).length, negative: rates.filter(value => value < 0).length,
    flat: rates.filter(value => value === 0).length, median: median(rates),
    balanceRmb: sumAvailableAmounts(rows.map(row => row.balanceRmb)),
    missingBalance: rows.filter(row => row.balanceRmb === null).length };
}
export function rateRange(rate: number | null): ReturnRange {
  if (rate === null || !Number.isFinite(rate)) return 'missing';
  return rate >= 0.2 ? 'high' : rate >= 0.1 ? 'middle' : rate >= 0.05 ? 'low' : rate >= 0 ? 'base' : 'negative';
}
export const RETURN_RANGES: ReturnRange[] = ['high', 'middle', 'low', 'base', 'negative', 'missing'];
export const BENCHMARK_BUCKETS: BenchmarkBucket[] = ['high', 'middle', 'low', 'below', 'unconfigured', 'missing'];
export function benchmarkBucket(row: ReturnRow, config: Benchmarks): BenchmarkBucket {
  const rule = benchmarkFor(config, row.product.category);
  if (rule.metric === 'none') return 'unconfigured';
  return benchmarkBand(config, row.product.category, rule.metric, row[rule.metric]) || 'missing';
}
export function distribution<T extends string>(rows: ReturnRow[], keys: T[], getKey: (row: ReturnRow) => T) {
  const groups = new Map(keys.map(key => [key, { count: 0, amounts: [] as Array<number | null> }]));
  for (const row of rows) {
    const group = groups.get(getKey(row));
    if (group) { group.count++; group.amounts.push(row.balanceRmb); }
  }
  return keys.map(key => {
    const group = groups.get(key)!;
    return { key, count: group.count, balanceRmb: sumAvailableAmounts(group.amounts) };
  });
}
export function compareReturns(rows: ReturnRow[], metric: ReturnMetric, dimension: 'category' | 'member' | 'currency') {
  const groups = new Map<string, ReturnRow[]>();
  for (const row of rows) {
    const key = row.product[dimension];
    const group = groups.get(key);
    if (group) group.push(row); else groups.set(key, [row]);
  }
  return [...groups].map(([key, items]) => {
    const summary = returnSummary(items, metric);
    const valid = items.map(row => row[metric]).filter((value): value is number => value !== null);
    return { key, ...summary, min: valid.length ? Math.min(...valid) : null, max: valid.length ? Math.max(...valid) : null };
  }).sort((a, b) => a.median === null ? b.median === null ? a.key.localeCompare(b.key, 'zh-CN') : 1 : b.median === null ? -1 : b.median - a.median || a.key.localeCompare(b.key, 'zh-CN'));
}
export function rankReturns(rows: ReturnRow[], metric: ReturnMetric, direction: 'desc' | 'asc') {
  return [...rows].sort((a, b) => {
    const x = a[metric], y = b[metric];
    if (x === null || y === null) return x === null ? y === null ? a.id.localeCompare(b.id) : 1 : -1;
    return (direction === 'desc' ? y - x : x - y) || a.product.name.localeCompare(b.product.name, 'zh-CN', { numeric: true }) || a.id.localeCompare(b.id);
  });
}

export type ReturnSelection = { kind: 'range'; key: ReturnRange; metric: ReturnMetric } | { kind: 'benchmark'; key: BenchmarkBucket };
export function returnDetailRows(rows: ReturnRow[], config: Benchmarks, selection: ReturnSelection): ReturnRow[] {
  return rows.filter(row => selection.kind === 'range'
    ? rateRange(row[selection.metric]) === selection.key
    : benchmarkBucket(row, config) === selection.key);
}
