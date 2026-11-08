import Decimal from 'decimal.js';
import type { MonthlyWorkbook, Product } from './workbook';
import { isoDate, serialDate, Scalar } from './formula';
import { sumAvailableAmounts } from './totals';
import { isCashAccount } from './categories';

export const LIQUIDITY_BUCKETS = ['undated', 'matured', 'thisMonth', 'nextThreeMonths', 'later', 'unknown'] as const;
export type LiquidityBucket = typeof LIQUIDITY_BUCKETS[number];
export type ProfitFilter = 'all' | 'profitable' | 'unprofitable' | 'unknown';
export interface LiquidityBounds { asOf: number; monthEnd: number; threeMonthEnd: number; }
export interface LiquidityRow { id: string; product: Product; gain: number | null; cost: number | null; deposit: boolean; balanceRmb: number | null; profit: Exclude<ProfitFilter, 'all'>; bucket: LiquidityBucket; date: string; days: number | null; rawDue: Scalar; }
export interface LiquidityFilters { member: string; currency: string; category: string; holdingOnly: boolean; profit: ProfitFilter; }
export const DEFAULT_LIQUIDITY_FILTERS: LiquidityFilters = { member: '全部', currency: '全部', category: '', holdingOnly: true, profit: 'all' };
export const LIQUIDITY_NAMES: Record<LiquidityBucket, string> = { matured: '已到期', thisMonth: '本月底前到期', nextThreeMonths: '随后三个月内到期', later: '更晚到期', undated: '随时可支取', unknown: '期限待核实' };
export function maturitySerial(value: Scalar): number | null {
  if (typeof value === 'number') return Number.isFinite(value) && value >= 1 && value <= 2958465 ? Math.floor(value) : null;
  if (typeof value !== 'string') return null;
  const match = value.trim().match(/^(\d{4})[-/](\d{1,2})[-/](\d{1,2})$/);
  if (!match) return null;
  try {
    const serial = serialDate(match[1] + '-' + match[2].padStart(2, '0') + '-' + match[3].padStart(2, '0'));
    return serial >= 1 && serial <= 2958465 ? serial : null;
  } catch { return null; }
}
export function liquidityToday(now = new Date()): string {
  return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-${String(now.getDate()).padStart(2, '0')}`;
}
export function liquidityBounds(value: Scalar = liquidityToday()): LiquidityBounds | null {
  const asOf = maturitySerial(value);
  if (asOf === null) return null;
  const date = new Date((asOf - 25569) * 86400000), year = date.getUTCFullYear(), month = date.getUTCMonth();
  return { asOf, monthEnd: Math.min(2958465, Date.UTC(year, month + 1, 0) / 86400000 + 25569),
    threeMonthEnd: Math.min(2958465, Date.UTC(year, month + 4, 0) / 86400000 + 25569) };
}
export function maturityBucket(raw: Scalar, bounds: LiquidityBounds | null): LiquidityBucket {
  if (raw === null || raw === 0 || typeof raw === 'string' && !raw.trim()) return 'undated';
  const due = maturitySerial(raw);
  if (due === null || !bounds) return 'unknown';
  return due <= bounds.asOf ? 'matured' : due <= bounds.monthEnd ? 'thisMonth' : due <= bounds.threeMonthEnd ? 'nextThreeMonths' : 'later';
}
export const profitStatus = (gain: unknown): Exclude<ProfitFilter, 'all'> => typeof gain !== 'number' || !Number.isFinite(gain) ? 'unknown' : gain > 0 ? 'profitable' : 'unprofitable';
// Shared XIRR blocks contain several products: only their explicitly mapped rows
// belong to this product. Independent blocks expose current net cost in I(summary).
export function liquidityCost(book: MonthlyWorkbook, product: Product): number | null {
  const block = product.block;
  if (!block) return null;
  if (block.shared) {
    if (!block.sourceRows?.length) return null;
    let cost = new Decimal(0);
    for (const row of block.sourceRows) {
      const amount = book.value(block.sheet, 'E' + row);
      if (typeof amount !== 'number' || !Number.isFinite(amount)) return null;
      cost = cost.plus(amount);
    }
    const result = cost.toNumber();
    return Number.isFinite(result) ? result : null;
  }
  const cost = book.value(block.sheet, 'I' + block.summary);
  if (typeof cost !== 'number' || !Number.isFinite(cost)) return null;
  // A newly created empty block has a placeholder zero, not a known cost.
  if (cost === 0 && !book.transactions(block).length) return null;
  return cost;
}
export function liquidityRows(book: MonthlyWorkbook, products: Product[], invalidKeys: string[] = [], asOf: Scalar = liquidityToday()): LiquidityRow[] {
  const bounds = liquidityBounds(asOf), invalid = new Set(invalidKeys);
  return products.map(product => {
    const id = product.sheet + ':' + product.row, rawDue = book.value(product.sheet, 'G' + product.row);
    const due = maturitySerial(rawDue), rate = book.exchangeRate(product.currency);
    const valid = !invalid.has(id);
    const cost = liquidityCost(book, product);
    const deposit = isCashAccount(product.category) || ['Time Deposit', '定期存款'].includes(product.category);
    const totalGain = valid && cost !== null && Number.isFinite(product.balance) ? new Decimal(product.balance).minus(cost).toNumber() : null;
    const gain = totalGain !== null && Number.isFinite(totalGain) ? totalGain : null;
    const converted = valid && Number.isFinite(product.balance) && product.balance >= 0 && Number.isFinite(rate) && rate > 0 ? new Decimal(product.balance).times(rate).toNumber() : null;
    return { id, product, gain, cost, deposit, balanceRmb: converted !== null && Number.isFinite(converted) ? converted : null,
      profit: deposit ? 'profitable' : profitStatus(gain), bucket: maturityBucket(rawDue, bounds), date: due === null ? '' : isoDate(due),
      days: due !== null && bounds ? due - bounds.asOf : null, rawDue };
  });
}
export function selectLiquidityRows(rows: LiquidityRow[], filters: LiquidityFilters): LiquidityRow[] {
  return rows.filter(row => (filters.member === '全部' || row.product.member === filters.member) &&
    (filters.currency === '全部' || row.product.currency === filters.currency) &&
    (!filters.category || row.product.category === filters.category) && (!filters.holdingOnly || row.product.balance > 0) &&
    (filters.profit === 'all' || row.profit === filters.profit));
}
export function liquidityGroups(rows: LiquidityRow[]) {
  return LIQUIDITY_BUCKETS.map(key => {
    const matched = rows.filter(row => row.bucket === key);
    return { key, count: matched.length, balanceRmb: sumAvailableAmounts(matched.map(row => row.balanceRmb)) };
  });
}
export function liquiditySummary(rows: LiquidityRow[]) {
  const total = (keys: LiquidityBucket[]) => sumAvailableAmounts(rows.filter(row => keys.includes(row.bucket)).map(row => row.balanceRmb));
  return { count: rows.length, balanceRmb: sumAvailableAmounts(rows.map(row => row.balanceRmb)),
    throughMonth: total(['matured', 'thisMonth']), nextThreeMonths: total(['nextThreeMonths']), availableNow: total(['undated']), unconfirmed: total(['unknown']),
    missingBalance: rows.filter(row => row.balanceRmb === null).length,
    profitable: rows.filter(row => row.profit === 'profitable').length, unprofitable: rows.filter(row => row.profit === 'unprofitable').length,
    unknownProfit: rows.filter(row => row.profit === 'unknown').length };
}
export function liquidityDetails(rows: LiquidityRow[], bucket: LiquidityBucket | 'all') {
  return rows.filter(row => bucket === 'all' || row.bucket === bucket).sort((a, b) => {
    if (!a.date || !b.date) return !a.date ? !b.date ? a.product.name.localeCompare(b.product.name, 'zh-CN') : 1 : -1;
    return a.date.localeCompare(b.date) || a.product.name.localeCompare(b.product.name, 'zh-CN');
  });
}
