import Decimal from 'decimal.js';
import { AssetType, Trade, Currency, tradeCurrency, currencies, compareTrades, completeStockCode, isStock } from './model';

export interface Holding {
  code: string;
  name: string;
  type: AssetType;
  currency?: Currency;
  totalCost: number;
  shares?: number;
  averagePrice?: number;
  stopPrice?: number;
  missingShares: number;
}
interface Total {
  value: number;
  correction: number;
  magnitude: number;
}
function add(total: Total, value: number): void {
  const adjusted = value - total.correction;
  const next = total.value + adjusted;
  total.correction = (next - total.value) - adjusted;
  total.value = next;
  total.magnitude += Math.abs(value);
}
const emptyTotal = (): Total => ({ value: 0, correction: 0, magnitude: 0 });

// Derived from visible trades only. Holdings are never persisted or written to Excel.
export function calculateHoldings(trades: Trade[]): Holding[] {
  const groups = new Map<string, {
    code: string; name: string; type: AssetType; currency?: Currency; latestDate: string;
    cost: Total; shares: Total; missingShares: number;
  }>();
  trades.forEach((trade) => {
    if (trade.brainstorm) return;
    const code = trade.code.trim().toUpperCase();
    const currency = tradeCurrency(trade);
    const key = JSON.stringify([trade.type, code, currency]);
    let group = groups.get(key);
    if (!group) {
      group = {
        code, name: trade.name, type: trade.type, currency, latestDate: trade.date,
        cost: emptyTotal(), shares: emptyTotal(), missingShares: 0,
      };
      groups.set(key, group);
    }
    if (trade.date > group.latestDate) {
      group.name = trade.name;
      group.latestDate = trade.date;
    }
    const sign = trade.direction === '买入' ? 1 : -1;
    add(group.cost, sign * trade.amount);
    if (trade.shares === undefined) group.missingShares += 1;
    else add(group.shares, sign * trade.shares);
  });
  const latestStops = new Map<string, number>();
  [...trades].sort(compareTrades).forEach(trade => {
    if (trade.brainstorm || trade.stopPrice === undefined) return;
    const key = JSON.stringify([trade.type, trade.code.trim().toUpperCase(), tradeCurrency(trade)]);
    if (!latestStops.has(key)) latestStops.set(key, trade.stopPrice);
  });
  const holdings: Holding[] = [];
  groups.forEach((group) => {
    const shares = group.missingShares ? undefined : group.shares.value;
    // Ignore floating point residue when fractional buys and sells exactly offset.
    if (shares !== undefined && Math.abs(shares) <= Number.EPSILON * group.shares.magnitude * 4) return;
    holdings.push({
      code: group.code,
      name: group.name,
      type: group.type,
      currency: group.currency,
      totalCost: group.cost.value,
      ...(latestStops.has(JSON.stringify([group.type, group.code, group.currency]))
        ? { stopPrice: latestStops.get(JSON.stringify([group.type, group.code, group.currency])) } : {}),
      shares,
      averagePrice: shares === undefined ? undefined : group.cost.value / shares,
      missingShares: group.missingShares,
    });
  });
  return holdings.sort((a, b) => a.code.localeCompare(b.code) || a.type.localeCompare(b.type) || (a.currency || '').localeCompare(b.currency || ''));
}

export function summarizeHoldingCosts(holdings: Holding[]): Record<Currency, number> {
  const totals = { HKD: emptyTotal(), USD: emptyTotal(), RMB: emptyTotal() };
  holdings.forEach(holding => {
    if (holding.currency && currencies.includes(holding.currency)) add(totals[holding.currency], holding.totalCost);
  });
  return { HKD: totals.HKD.value, USD: totals.USD.value, RMB: totals.RMB.value };
}

export function findClosingHolding(
  trades: Trade[],
  draft: Pick<Trade, 'code' | 'type' | 'date' | 'direction'>,
  editing?: Trade | null,
): Holding | undefined {
  if (!isStock(draft.type) || !draft.code.trim()) return;
  const code = completeStockCode(draft.type, draft.code.trim().toUpperCase());
  const matching = trades.filter(trade => trade.type === draft.type &&
    completeStockCode(trade.type, trade.code.trim().toUpperCase()) === code &&
    trade.id !== editing?.id && trade.date <= draft.date &&
    (!editing || draft.date !== editing.date || trade.date !== editing.date || compareTrades(trade, editing) > 0));
  return calculateHoldings(matching.map(trade => ({ ...trade, code }))).find(holding =>
    holding.shares !== undefined && (draft.direction === '卖出' ? holding.shares > 0 : holding.shares < 0));
}

export function estimateClosingProfit(holding: Holding | undefined, shares: string, amount: string): string {
  if (!holding?.currency || !holding.shares || !Number.isFinite(holding.totalCost)) return '';
  try {
    const quantity = new Decimal(shares);
    const total = new Decimal(amount);
    if (!quantity.isFinite() || !total.isFinite() || quantity.lte(0) || total.lte(0)) return '';
    const average = new Decimal(holding.totalCost).div(holding.shares);
    const closedShares = Decimal.min(quantity, Math.abs(holding.shares));
    const profit = total.div(quantity).minus(average).times(closedShares)
      .times(holding.shares > 0 ? 1 : -1).toDecimalPlaces(2);
    const formatted = profit.toFixed(2).replace(/\B(?=(\d{3})+\.)/g, ',');
    return `预计盈亏：${holding.currency} ${profit.gt(0) ? '+' : ''}${formatted}`;
  } catch { return ''; }
}
