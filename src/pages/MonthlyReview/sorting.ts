import { MonthlyWorkbook, Product } from './workbook';
import { productKey } from './batch';

export type ProductSortField = 'name' | 'balance' | 'previous' | 'gain' | 'xirr' | 'twr';
export interface ProductSort { field: ProductSortField; direction: 'asc' | 'desc'; }
export function nextProductSort(current: ProductSort | null, field: ProductSortField): ProductSort | null {
  return current?.field !== field ? { field, direction: 'asc' } : current.direction === 'asc' ? { field, direction: 'desc' } : null;
}
export function sortedProducts(products: Product[], book: MonthlyWorkbook, sort: ProductSort | null, invalid = new Set<string>()): Product[] {
  if (!sort) return [...products];
  const value = (p: Product) => {
    if (sort.field === 'name') return p.name;
    if (sort.field === 'previous') return p.previous;
    if (invalid.has(productKey(p))) return null;
    return sort.field === 'balance' ? p.balance : book.value(p.sheet, `${{ gain: 'J', xirr: 'K', twr: 'L' }[sort.field]}${p.row}`);
  };
  return products.map((product, index) => ({ product, index, value: value(product) })).sort((a, b) => {
    let compare: number;
    if (sort.field === 'name') compare = String(a.value).localeCompare(String(b.value), 'zh-CN', { numeric: true });
    else {
      const validA = typeof a.value === 'number' && Number.isFinite(a.value), validB = typeof b.value === 'number' && Number.isFinite(b.value);
      if (!validA || !validB) return validA ? -1 : validB ? 1 : a.index - b.index;
      compare = Number(a.value) - Number(b.value);
    }
    return (sort.direction === 'asc' ? compare : -compare) || a.index - b.index;
  }).map(row => row.product);
}
