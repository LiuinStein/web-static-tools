export function normalizeProductCategory(category: string): string {
  if (category === '定期存款') return 'Time Deposit';
  return ['Monetary Fund', 'Current Account', '货币基金', '活期账户', '活期存款'].includes(category) ? 'Current Account' : category;
}
export function isCashAccount(category: string): boolean { return normalizeProductCategory(category) === 'Current Account'; }
export function isBalanceOnly(category: string): boolean { return isCashAccount(category) || normalizeProductCategory(category) === 'Time Deposit'; }
