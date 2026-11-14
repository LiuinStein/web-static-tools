import Decimal from 'decimal.js';

export const assetTypes = ['港股', '美股', 'A股', '债券基金', '股票基金'] as const;
export type AssetType = typeof assetTypes[number];
export const currencies = ['HKD', 'USD', 'RMB'] as const;
export type Currency = typeof currencies[number];
export function stockCurrency(type: AssetType): Currency | undefined {
  return ({ '港股': 'HKD', '美股': 'USD', 'A股': 'RMB' } as const)[type];
}
export function tradeCurrency(trade: Pick<Trade, 'type' | 'currency'>): Currency | undefined {
  return stockCurrency(trade.type) || trade.currency;
}
export interface Trade {
  id: string;
  date: string;
  createdAt?: string;
  type: AssetType;
  currency?: Currency;
  code: string;
  name: string;
  stance: '看多' | '看空' | '平仓';
  direction: '买入' | '卖出';
  amount: number;
  price?: number;
  shares?: number;
  fee: number;
  reason: string;
  brainstorm?: boolean;
}
export function calculateFee(amount: number, price: number, shares?: number): number {
  if (![amount, price, shares].every((value) => Number.isFinite(value))) return 0;
  return Math.round((amount - price * shares! + Number.EPSILON) * 100) / 100;
}
export function today(): string {
  const date = new Date();
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(
    2,
    '0',
  )}`;
}
export function compareTrades(a: Trade, b: Trade): number {
  return b.date.localeCompare(a.date) || (b.createdAt || '').localeCompare(a.createdAt || '') || a.id.localeCompare(b.id);
}
export function validateTrade(trade: Trade): void {
  const parsed = new Date(`${trade.date}T12:00:00`);
  if (
    !/^\d{4}-\d{2}-\d{2}$/.test(trade.date) ||
    Number.isNaN(parsed.getTime()) ||
    parsed.getFullYear() !== Number(trade.date.slice(0, 4)) ||
    parsed.getMonth() + 1 !== Number(trade.date.slice(5, 7)) ||
    parsed.getDate() !== Number(trade.date.slice(8, 10))
  ) throw new Error('请输入有效交易日期');
  if (trade.createdAt !== undefined && (!Number.isFinite(Date.parse(trade.createdAt)) || new Date(trade.createdAt).toISOString() !== trade.createdAt)) throw new Error('记录时间无效');
  if (!trade.id || !trade.code.trim() || !trade.name.trim()) throw new Error('代码和名称必填');
  if (
    !assetTypes.includes(trade.type) ||
    !['看多', '看空', '平仓'].includes(trade.stance) ||
    !['买入', '卖出'].includes(trade.direction)
  ) throw new Error('交易分类无效');
  if (trade.currency !== undefined && !currencies.includes(trade.currency)) throw new Error('货币标记无效');
  if (stockCurrency(trade.type) && trade.currency && trade.currency !== stockCurrency(trade.type)) throw new Error('股票货币标记与市场不匹配');
  if (!Number.isFinite(trade.amount) || trade.amount <= 0) throw new Error('金额必须大于 0');
  if (trade.price === undefined) {
    if (isStock(trade.type)) throw new Error('股票单价必填');
  } else if (!Number.isFinite(trade.price) || trade.price <= 0) throw new Error('单价必须大于 0，基金可留空');
  if (!Number.isFinite(trade.fee)) throw new Error('交易费用无效');
  if (isStock(trade.type) && trade.shares === undefined) throw new Error('股票份额必填');
  if (trade.shares !== undefined && (!Number.isFinite(trade.shares) || trade.shares <= 0)) throw new Error(isStock(trade.type) ? '股票份额必须大于 0' : '份额需大于 0，或留空');
}
export function mergeTrades(remote: Trade[], pending: Trade[]): Trade[] {
  const records = new Map(remote.map((trade) => [trade.id, trade]));
  pending.forEach((trade) => {
    const existing = records.get(trade.id);
    if (existing && !sameTrade(existing, trade)) throw new Error('发现重复记录 ID 且内容不同，请检查 Excel 文件');
    records.set(trade.id, trade);
  });
  return Array.from(records.values()).sort(compareTrades);
}

export interface TradeChange {
  operationId: string;
  id: string;
  before: Trade;
  after?: Trade;
}
export function sameTrade(left: Trade | undefined, right: Trade | undefined): boolean {
  if (!left || !right) return left === right;
  const keys: Array<keyof Trade> = [
    'id',
    'date',
    'type',
    'code',
    'name',
    'stance',
    'direction',
    'amount',
    'price',
    'shares',
    'fee',
    'reason',
  ];
  return left.createdAt === right.createdAt && tradeCurrency(left) === tradeCurrency(right) && !!left.brainstorm === !!right.brainstorm && keys.every((key) => left[key] === right[key]);
}
export function applyChanges(trades: Trade[], changes: TradeChange[]): Trade[] {
  const records = new Map(trades.map((trade) => [trade.id, trade]));
  changes.forEach((change) => {
    const current = records.get(change.id);
    // A successful upload whose response was lost can be safely retried.
    if (sameTrade(current, change.after)) return;
    if (!sameTrade(current, change.before)) {
      throw new Error(
        `“${change.before.name}”已在其他设备修改或删除，未覆盖云端数据。请保留待同步记录并导出备份后处理冲突。`,
      );
    }
    if (change.after) {
      validateTrade(change.after);
      if (change.after.id !== change.id) throw new Error('编辑不能更改记录 ID');
      records.set(change.id, change.after);
    } else records.delete(change.id);
  });
  return Array.from(records.values()).sort(compareTrades);
}
export function queueChange(
  remote: Trade[],
  pending: Trade[],
  changes: TradeChange[],
  before: Trade,
  after?: Trade,
): TradeChange[] {
  const visible = visibleTrades(remote, pending, changes);
  if (
    !sameTrade(
      visible.find((trade) => trade.id === before.id),
      before,
    )
  ) {
    throw new Error('记录已发生变化，请重新打开编辑或删除操作');
  }
  const previous = changes.find((change) => change.id === before.id);
  const change: TradeChange = {
    operationId: crypto.randomUUID(),
    id: before.id,
    before: previous ? previous.before : before,
  };
  if (after) change.after = after;
  return [...changes.filter((item) => item.id !== before.id), change];
}
export function mergeForSync(remote: Trade[], pending: Trade[], changes: TradeChange[]): Trade[] {
  const creates = pending.filter((trade) => {
    const existing = remote.find((item) => item.id === trade.id);
    return !existing || !changes.some((change) => change.id === trade.id && sameTrade(existing, change.after));
  });
  return applyChanges(mergeTrades(remote, creates), changes);
}

export function visibleTrades(remote: Trade[], pending: Trade[], changes: TradeChange[]): Trade[] {
  // Keep unsynced local work visible even when a remote conflict needs resolution.
  const records = new Map(remote.map((trade) => [trade.id, trade]));
  pending.forEach((trade) => records.set(trade.id, trade));
  changes.forEach((change) => {
    if (change.after) records.set(change.id, change.after);
    else records.delete(change.id);
  });
  return Array.from(records.values()).sort(compareTrades);
}

export function isStock(type: AssetType): boolean {
  return ['港股', '美股', 'A股'].includes(type);
}

export interface PricingDraft {
  type: AssetType;
  price: string;
  shares: string;
  amount: string;
  amountManual: boolean;
}
export function updatePricingDraft<T extends PricingDraft>(draft: T, key: 'type' | 'price' | 'shares' | 'amount', value: string): T {
  const next = { ...draft, [key]: value, amountManual: key === 'amount' ? true : draft.amountManual };
  if (isStock(next.type) && !next.amountManual) {
    try {
      const price = new Decimal(next.price), shares = new Decimal(next.shares);
      next.amount = price.isFinite() && shares.isFinite() && price.gt(0) && shares.gt(0) ? price.times(shares).toString() : '';
    } catch { next.amount = ''; }
  }
  return next;
}

const stockCodeRules = {
  'A股': { pattern: '[0-9]{6}', placeholder: '6 位数字，如 600519', message: 'A 股代码需为 6 位数字，输入完成后自动补前导零' },
  '港股': { pattern: '[0-9]{5}', placeholder: '5 位数字，如 00700', message: '港股代码需为 5 位数字，输入完成后自动补前导零' },
  '美股': { pattern: '[A-Z]{1,5}([.][A-Z]{1,3}|-[A-Z]{1,3})?', placeholder: '如 AAPL / BRK.B', message: '美股代码需为 1–5 位大写字母，可带 . 或 - 分隔的 1–3 位类别后缀' },
};
export function stockCodeRule(type: AssetType): { pattern: string; placeholder: string; message: string } | undefined {
  return stockCodeRules[type];
}
export function normalizeCodeInput(type: AssetType, value: string): string {
  if (type === 'A股' || type === '港股') return value.replace(/[^0-9]/g, '').slice(0, type === 'A股' ? 6 : 5);
  if (type === '美股') return value.toUpperCase().replace(/[^A-Z.-]/g, '').slice(0, 9);
  return value.toUpperCase();
}
export function validateStockCode(type: AssetType, code: string): void {
  const rule = stockCodeRule(type);
  if (rule && !new RegExp(`^(?:${rule.pattern})$`).test(code)) throw new Error(rule.message);
}

export function completeStockCode(type: AssetType, value: string): string {
  const code = value.trim();
  const width = type === 'A股' ? 6 : type === '港股' ? 5 : 0;
  return width && /^[0-9]+$/.test(code) && code.length <= width ? code.padStart(width, '0') : code;
}
