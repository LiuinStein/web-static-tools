import Decimal from 'decimal.js';
import { serialDate } from './formula';
import type { Transaction } from './workbook';

export function validateTransactions(rows: Transaction[], endDate: number, afterDate?: number): number {
  if (!rows.length) throw new Error('请至少登记一笔交易，或切换为直接填写净投入');
  let remaining = new Decimal(0), previous = 0;
  for (const row of rows) {
    const date = row.date ? serialDate(row.date) : 0;
    if (!date || date < previous || date > endDate) throw new Error('交易日期须完整、按时间排序，且不晚于记账日期');
    if (afterDate !== undefined && date <= afterDate) throw new Error('新增产品没有上期余额，初始交易须在上次记账日期之后，可在本期内跨月记录');
    if (!['buy', 'sell', 'dividend'].includes(row.kind) || !(row.amount > 0) || !Number.isFinite(row.amount) || !Number.isFinite(row.shares) || !Number.isFinite(row.price) || row.price <= 0 || (row.kind !== 'dividend' && row.shares <= 0) || (row.kind === 'dividend' && row.shares !== 0)) throw new Error('金额、份额或价格无效；分红份额应为 0');
    remaining = remaining.plus(row.kind === 'buy' ? row.shares : row.kind === 'sell' ? -row.shares : 0);
    if (remaining.lt(-1e-7) || (row.kind === 'dividend' && remaining.lte(0))) throw new Error('卖出份额超过持仓，或分红时没有持仓');
    previous = date;
  }
  return remaining.toNumber();
}

// Incomplete form rows do not contribute until their dates and amounts are valid.
// Saving performs the stricter validation above before any workbook mutation.
export function cashFlowSummary(rows: Transaction[], startDate: number, endDate: number) {
  let buys = new Decimal(0), sales = new Decimal(0), dividends = new Decimal(0);
  for (const row of rows) {
    let date = 0;
    try { date = row.date ? serialDate(row.date) : 0; } catch { continue; }
    if (date <= startDate || date > endDate || !Number.isFinite(row.amount) || row.amount <= 0) continue;
    if (row.kind === 'buy') buys = buys.plus(row.amount);
    else if (row.kind === 'sell') sales = sales.plus(row.amount);
    else if (row.kind === 'dividend') dividends = dividends.plus(row.amount);
  }
  return { buys: buys.toNumber(), sales: sales.toNumber(), dividends: dividends.toNumber(), net: buys.minus(sales).minus(dividends).toNumber() };
}
