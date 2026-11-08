import type { Product } from './workbook';

export interface ReviewAccount { member: string; account: string; }

// Match the account dropdown order; an account spanning currencies is one stop.
export function reviewAccounts(products: Pick<Product, 'member' | 'account'>[]): ReviewAccount[] {
  const compare = (a: string, b: string) => a.localeCompare(b, 'zh-CN', { numeric: true });
  const members = [...new Set(products.map(p => p.member))].sort((a, b) =>
    a === b ? 0 : a === '本人' ? -1 : b === '本人' ? 1 : compare(a, b));
  return members.flatMap(member => [...new Set(products.filter(p => p.member === member).map(p => p.account))]
    .sort(compare).map(account => ({ member, account })));
}

export function nextReviewAccount(accounts: ReviewAccount[], current: ReviewAccount) {
  const index = accounts.findIndex(a => a.member === current.member && a.account === current.account);
  const target = index >= 0 ? accounts[index + 1] : accounts.find(a => a.member === current.member) || accounts[0];
  return { target, changesMember: Boolean(target && current.member !== '全部' && target.member !== current.member) };
}
