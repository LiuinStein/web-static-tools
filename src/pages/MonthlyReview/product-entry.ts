import { MonthlyWorkbook, Product, Transaction } from './workbook';
import { validateTransactions } from './transactions';

export interface ProductGroup { key: string; sheet: string; member: string; currency: string; category: string; }
const groupKey = (p: Product) => JSON.stringify([p.sheet, p.currency, p.category]);
export function productGroups(products: Product[]): ProductGroup[] {
  const groups = new Map<string, ProductGroup>();
  for (const p of products) {
    const key = groupKey(p);
    if (!groups.has(key)) groups.set(key, { key, sheet: p.sheet, member: p.member, currency: p.currency, category: p.category });
  }
  return [...groups.values()];
}

export interface NewProductValues { name: string; account: string; balance: number; flow: number; due: string; note: string; }
export function createProductEntry(book: MonthlyWorkbook, key: string, values: NewProductValues, mode: 'manual' | 'transactions', rows: Transaction[] = []): Product {
  const name = values.name.trim(), account = values.account.trim();
  if (!name || !account || !Number.isFinite(values.balance) || values.balance < 0) throw new Error('请填写有效的产品名称、账户与本期余额');
  if (mode === 'manual' && !Number.isFinite(values.flow)) throw new Error('请填写有效的净投入金额');
  if (mode === 'transactions') validateTransactions(rows, book.number('Assets', 'L1'), book.number('Assets', 'N1'));
  const candidates = book.products().filter(p => groupKey(p) === key);
  // Row positions are an internal template mapping, not user-facing group choices.
  const anchor = candidates.find(p => p.account === account) || candidates[0];
  if (!anchor) throw new Error('请选择有效的所属分组');
  const created = book.addProduct(anchor, name, account);
  book.updateProduct(created, { ...values, name, account, previous: 0, flow: mode === 'manual' ? values.flow : 0 });
  if (mode === 'transactions') book.saveTransactions(created, rows);
  return book.products().find(p => p.sheet === created.sheet && p.row === created.row)!;
}
