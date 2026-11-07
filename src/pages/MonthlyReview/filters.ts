import type { Product } from './workbook';
export interface AssetFilters { member: string; currency: string; account: string; }
export function linkedOptions(products: Product[], filters: AssetFilters) {
  const options = (field: keyof AssetFilters) => [...new Set(products.filter(p =>
    (field === 'member' || filters.member === '全部' || p.member === filters.member) &&
    (field === 'currency' || filters.currency === '全部' || p.currency === filters.currency) &&
    (field === 'account' || !filters.account || p.account === filters.account)
  ).map(p => p[field]))].sort((a, b) => a.localeCompare(b, 'zh-CN', { numeric: true }));
  return { members: options('member'), currencies: options('currency'), accounts: options('account') };
}
