export function normalizeProductCategory(category: string): string {
  return ['Monetary Fund', 'Current Account', '货币基金', '活期账户', '活期存款'].includes(category) ? 'Current Account' : category;
}
export function isCashAccount(category: string): boolean { return normalizeProductCategory(category) === 'Current Account'; }
