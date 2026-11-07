// Keep raw decimal text (including a trailing decimal point) while grouping digits.
export const rawAmount = (value: string) => value.replace(/,/g, '');
export function formatAmount(value: string | number): string {
  const raw = rawAmount(String(value));
  if (!/^-?\d*(\.\d*)?$/.test(raw)) return raw;
  const [integer, fraction] = raw.split('.');
  return integer.replace(/\B(?=(\d{3})+(?!\d))/g, ',') + (fraction === undefined ? '' : '.' + fraction);
}
export const currencyCode = (code: string) => code === 'CNY' ? 'RMB' : code;

const fixedAmountFormat = new Intl.NumberFormat('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
export function formatFixedAmount(value: string): string {
  const raw = rawAmount(value);
  return raw.trim() !== '' && Number.isFinite(Number(raw)) ? fixedAmountFormat.format(Number(raw)) : raw;
}
