import Decimal from 'decimal.js';
import { Broker, FeeRule, Instrument, Market, getPlan } from './rates';

export interface TradeInput { market: Market; broker: Broker; price: number; shares: number; instrument?: Instrument; commissionFree?: boolean; oddLotSell?: boolean; }
export interface FeeLine { id: string; label: string; category: FeeRule['category']; amount: number; description: string; }
export interface TradeResult { notional: number; lines: FeeLine[]; brokerFees: number; thirdPartyFees: number; total: number; cash: number; }
const sum = (values: number[]) => values.reduce((total, value) => total.plus(value), new Decimal(0)).toNumber();
function validate(input: TradeInput): void {
  getPlan(input.market, input.broker);
  if (!Number.isFinite(input.price) || input.price <= 0 || input.price > 1e9) throw new Error('股价须大于 0 且不超过 10 亿');
  if (!Number.isSafeInteger(input.shares) || input.shares <= 0 || input.shares > 1e9) throw new Error('股数须为 1 至 10 亿之间的整数；不足 1 股的订单另有收费');
  if (new Decimal(input.price).times(input.shares).gt('1e15')) throw new Error('成交金额过大，请减少股价或股数');
  if (input.instrument !== undefined && !['stock', 'etf'].includes(input.instrument)) throw new Error('请选择股票或 ETF');
}
export function calculateTrade(input: TradeInput, side: 'buy' | 'sell'): TradeResult {
  validate(input);
  const notional = new Decimal(input.price).times(input.shares);
  const lines = getPlan(input.market, input.broker).rules.map(rule => {
    const exempt = (rule.side === 'sell' && side === 'buy') || (rule.stockOnly && input.instrument === 'etf') || (rule.waivable && input.commissionFree) || (rule.exemptBelowPrice && new Decimal(input.price).lt(rule.exemptBelowPrice)) || (rule.id === 'platform' && input.market === 'HK' && input.broker === 'za' && side === 'sell' && input.oddLotSell);
    let amount = new Decimal(0);
    if (!exempt) {
      const base = rule.basis === 'notional' ? notional : rule.basis === 'shares' ? new Decimal(input.shares) : new Decimal(1);
      amount = base.times(rule.rate);
      // A rate cap is applied before the minimum: the published minimum takes priority.
      if (rule.maximumRate) amount = Decimal.min(amount, notional.times(rule.maximumRate));
      if (rule.minimum) amount = Decimal.max(amount, rule.minimum);
      if (rule.maximum) amount = Decimal.min(amount, rule.maximum);
      amount = amount.toDecimalPlaces(rule.decimals ?? 2, rule.rounding === 'up' ? Decimal.ROUND_CEIL : Decimal.ROUND_HALF_UP);
    }
    return { id: rule.id, label: rule.label, category: rule.category, amount: amount.toNumber(), description: rule.description };
  });
  const brokerFees = sum(lines.filter(line => line.category === 'broker').map(line => line.amount));
  const thirdPartyFees = sum(lines.filter(line => line.category === 'thirdParty').map(line => line.amount));
  const total = sum([brokerFees, thirdPartyFees]);
  return { notional: notional.toNumber(), lines, brokerFees, thirdPartyFees, total, cash: (side === 'buy' ? notional.plus(total) : notional.minus(total)).toNumber() };
}
export function calculateRoundTrip(input: TradeInput, sellPrice = input.price) {
  const buy = calculateTrade(input, 'buy'), sell = calculateTrade({ ...input, price: sellPrice }, 'sell');
  const total = sum([buy.total, sell.total]);
  return { buy, sell, total, feeRate: new Decimal(total).div(buy.notional).toNumber(), profit: new Decimal(sell.cash).minus(buy.cash).toNumber() };
}
// Solve using the actual sell-side fees, including amount-dependent taxes and rounding.
// The reference is not rounded to an exchange tick: HK tick sizes depend on the security.
export function breakEvenPrice(input: TradeInput): number | null {
  const buy = calculateTrade(input, 'buy');
  const net = (price: number) => new Decimal(calculateTrade({ ...input, price }, 'sell').cash).minus(buy.cash);
  if (net(input.price).gte(0)) return input.price;
  let low = input.price, high = Math.min(1e9, 1e15 / input.shares, Math.max(input.price * 2, input.price + 1));
  while (net(high).lt(0)) {
    const next = Math.min(1e9, 1e15 / input.shares, high * 2);
    if (next <= high) return null;
    high = next;
  }
  for (let i = 0; i < 70; i++) {
    const middle = low + (high - low) / 2;
    if (net(middle).gte(0)) high = middle; else low = middle;
  }
  const rounded = new Decimal(high).toDecimalPlaces(6, Decimal.ROUND_CEIL).toNumber();
  if (rounded > 1e9 || new Decimal(rounded).times(input.shares).gt('1e15')) return null;
  return rounded;
}
export function parseTradeNumber(text: string, integer = false): number | null {
  const value = text.trim();
  if (!(integer ? /^\d+$/ : /^(?:\d+(?:\.\d*)?|\.\d+)$/).test(value)) return null;
  const number = Number(value);
  if (!Number.isFinite(number) || number <= 0 || number > 1e9 || (integer && !Number.isSafeInteger(number))) return null;
  return number;
}
