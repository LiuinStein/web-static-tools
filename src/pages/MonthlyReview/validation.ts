export function productBalance(text: string, label: string): number {
  if (text.trim() === '' || !Number.isFinite(Number(text)) || Number(text) < 0) throw new Error(`${label}须为有效的非负金额，不能留空`);
  return Number(text);
}

export function validateProductNames(name: string, account: string): void {
  if (!name.trim() || !account.trim()) throw new Error('请填写产品名称和账户');
  if (name.trim() === 'Product' || ['Sub Total', 'Grand Total', 'Account', 'Exchange Rate:'].includes(account.trim()) || /Exchange Rate/.test(account)) {
    throw new Error('名称与模板表头或合计标记重复，请使用其他名称');
  }
}
