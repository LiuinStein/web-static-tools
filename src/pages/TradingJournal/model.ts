export type AssetType = '股票' | '基金';
export interface Trade {
  id: string;
  date: string;
  type: AssetType;
  code: string;
  name: string;
  stance: '看多' | '看空' | '平仓';
  direction: '买入' | '卖出';
  amount: number;
  price: number;
  shares?: number;
  fee: number;
  reason: string;
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
export function validateTrade(trade: Trade): void {
  const parsed = new Date(`${trade.date}T12:00:00`);
  if (
    !/^\d{4}-\d{2}-\d{2}$/.test(trade.date) ||
    Number.isNaN(parsed.getTime()) ||
    parsed.getFullYear() !== Number(trade.date.slice(0, 4)) ||
    parsed.getMonth() + 1 !== Number(trade.date.slice(5, 7)) ||
    parsed.getDate() !== Number(trade.date.slice(8, 10))
  ) throw new Error('请输入有效交易日期');
  if (!trade.id || !trade.code.trim() || !trade.name.trim()) throw new Error('代码和名称必填');
  if (
    !['股票', '基金'].includes(trade.type) ||
    !['看多', '看空', '平仓'].includes(trade.stance) ||
    !['买入', '卖出'].includes(trade.direction)
  ) throw new Error('交易分类无效');
  if (![trade.amount, trade.price].every((value) => Number.isFinite(value) && value > 0)) throw new Error('金额和单价必须大于 0');
  if (!Number.isFinite(trade.fee)) throw new Error('交易费用无效');
  if (trade.shares !== undefined && (!Number.isFinite(trade.shares) || trade.shares <= 0)) throw new Error('份额需大于 0，或留空');
}
export function mergeTrades(remote: Trade[], pending: Trade[]): Trade[] {
  const records = new Map(remote.map((trade) => [trade.id, trade]));
  pending.forEach((trade) => {
    const existing = records.get(trade.id);
    if (existing && !sameTrade(existing, trade)) throw new Error('发现重复记录 ID 且内容不同，请检查 Excel 文件');
    records.set(trade.id, trade);
  });
  return Array.from(records.values()).sort((a, b) => b.date.localeCompare(a.date) || a.id.localeCompare(b.id));
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
  return keys.every((key) => left[key] === right[key]);
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
  return Array.from(records.values()).sort((a, b) => b.date.localeCompare(a.date) || a.id.localeCompare(b.id));
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
  return Array.from(records.values()).sort((a, b) => b.date.localeCompare(a.date) || a.id.localeCompare(b.id));
}
