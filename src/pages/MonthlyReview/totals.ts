import Decimal from 'decimal.js';

// Missing or unavailable results do not suppress the other products' gains.
export function sumAvailableAmounts(values: unknown[]): number | null {
  const amounts = values.filter((value): value is number => typeof value === 'number' && Number.isFinite(value));
  return amounts.length ? amounts.reduce((total, value) => total.plus(value), new Decimal(0)).toNumber() : null;
}
