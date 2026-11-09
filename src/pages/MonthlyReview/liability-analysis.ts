import Decimal from 'decimal.js';
import type { Liability } from './workbook';
import { productKey } from './batch';

// Incomplete batch inputs must not silently become zero or retain an old total.
export function liabilityTotals(rows: Liability[], invalidKeys: string[] = []) {
  const invalid = new Set(invalidKeys);
  const sum = (values: number[]) => values.every(Number.isFinite)
    ? values.reduce((total, value) => total.plus(value), new Decimal(0)).toNumber() : null;
  const previous = sum(rows.map(row => row.previous));
  const balance = rows.some(row => invalid.has(productKey(row))) ? null : sum(rows.map(row => row.balance));
  const growth = balance === null || previous === null ? null : new Decimal(balance).minus(previous).toNumber();
  return { previous, balance, growth };
}

export function debtRatio(debt: number | null, assets: unknown): number | null {
  return debt !== null && Number.isFinite(debt) && debt >= 0 && typeof assets === 'number' && Number.isFinite(assets) && assets > 0
    ? new Decimal(debt).div(assets).toNumber() : null;
}
