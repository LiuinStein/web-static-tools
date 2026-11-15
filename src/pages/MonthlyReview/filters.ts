import type { MonthlyWorkbook, Product } from './workbook';
import { BenchmarkBand, Benchmarks, matchesBenchmarkBand } from './benchmarks';
import { currentProductProfit } from './liquidity-analysis';
export type AssetReturnFilter = BenchmarkBand | 'all' | 'profitable' | 'unprofitable';
export function matchesAssetReturnFilter(book: MonthlyWorkbook | null, product: Product, benchmarks: Benchmarks, filter: AssetReturnFilter, invalid = false): boolean {
  if (filter === 'all') return true;
  if (!book) return false;
  if (filter === 'profitable' || filter === 'unprofitable') {
    const profit = invalid ? null : currentProductProfit(book, product);
    return profit !== null && (filter === 'profitable' ? profit >= 0 : profit < 0);
  }
  return matchesBenchmarkBand(benchmarks, product.category, book.value(product.sheet, 'K' + product.row), book.value(product.sheet, 'L' + product.row), filter);
}
export interface AssetFilters { member: string; currency: string; account: string; }
export function linkedOptions(products: Product[], filters: AssetFilters) {
  const options = (field: keyof AssetFilters) => [...new Set(products.filter(p =>
    (field === 'member' || filters.member === '全部' || p.member === filters.member) &&
    (field === 'currency' || filters.currency === '全部' || p.currency === filters.currency) &&
    (field === 'account' || !filters.account || p.account === filters.account)
  ).map(p => p[field]))].sort((a, b) => a.localeCompare(b, 'zh-CN', { numeric: true }));
  return { members: options('member'), currencies: options('currency'), accounts: options('account') };
}
