import { MonthlyWorkbook, Product } from './workbook';
import { isCashAccount } from './categories';

export const productKey = (p: Product) => `${p.sheet}:${p.row}`;
export function balanceNumber(text: string): number | null {
  const value = text.trim();
  if (!/^(?:\d+(?:\.\d*)?|\.\d+|\d{1,3}(?:,\d{3})+(?:\.\d*)?)$/.test(value)) return null;
  const number = Number(value.replace(/,/g, ''));
  return Number.isFinite(number) && number >= 0 ? number : null;
}
export function flowNumber(text: string): number | null {
  const trimmed = text.trim(), number = balanceNumber(trimmed.replace(/^[+-]/, ''));
  return number === null ? null : trimmed.startsWith('-') ? -number : number;
}
export function balancePaste(visible: Product[], start: string, text: string): Array<[string, string]> {
  const lines = text.replace(/\r\n?/g, '\n').replace(/\n+$/, '').split('\n');
  const index = visible.findIndex(p => productKey(p) === start);
  if (index < 0 || index + lines.length > visible.length) throw new Error('粘贴行数超出当前可见产品范围，请核对筛选条件和起始行');
  if (lines.some(line => line.includes('\t'))) throw new Error('请只复制一列余额，不要包含产品名称或其他列');
  if (lines.some(line => balanceNumber(line) === null)) throw new Error('粘贴内容含空白、负数或无效余额，本次粘贴未应用');
  return lines.map((line, i) => [productKey(visible[index + i]), line.trim()]);
}
const signature = (p: Product) => JSON.stringify([p.sheet, p.member, p.currency, p.category, p.account, p.name, p.balance, p.previous, p.flow, p.due, p.note]);

// A session owns an isolated workbook. Nothing reaches IndexedDB until the page saves it.
export class MonthlyBatch {
  readonly book: MonthlyWorkbook;
  readonly original: MonthlyWorkbook;
  readonly inputs: Map<string, string>;
  readonly reviewed: Set<string>;
  readonly touched: Set<string>;
  readonly dirty: boolean;
  readonly flows: Map<string, string>;
  constructor(original: MonthlyWorkbook, book = original.clone(), inputs = new Map<string, string>(), reviewed = new Set<string>(), touched = new Set<string>(), dirty = false, flows = new Map<string, string>()) {
    this.original = original; this.book = book; this.inputs = inputs; this.reviewed = reviewed; this.touched = touched; this.dirty = dirty; this.flows = flows;
  }
  get invalidBalances(): string[] { return [...this.inputs].filter(([, text]) => balanceNumber(text) === null).map(([key]) => key); }
  get invalidFlows(): string[] { return [...this.flows].filter(([, text]) => flowNumber(text) === null).map(([key]) => key); }
  get invalid(): string[] { return [...new Set([...this.invalidBalances, ...this.invalidFlows])]; }
  balances(changes: Array<[string, string]>): MonthlyBatch {
    const next = this.book.clone(), inputs = new Map(this.inputs), reviewed = new Set(this.reviewed);
    const products = new Map(next.products().map(p => [productKey(p), p]));
    for (const [key, text] of changes) {
      const p = products.get(key); if (!p) throw new Error('产品位置已变化，请重新选择');
      inputs.set(key, text); const number = balanceNumber(text);
      reviewed.delete(key);
      if (number !== null) next.set(p.sheet, `E${p.row}`, number);
    }
    return new MonthlyBatch(this.original, next, inputs, reviewed, new Set(this.touched), true, this.flows);
  }
  cashFlows(changes: Array<[string, string]>): MonthlyBatch {
    const next = this.book.clone(), flows = new Map(this.flows), reviewed = new Set(this.reviewed);
    const products = new Map(next.products().map(p => [productKey(p), p]));
    for (const [key, text] of changes) {
      const p = products.get(key); if (!p) throw new Error('产品位置已变化，请重新选择');
      if (isCashAccount(p.category)) throw new Error('活期账户净投入按本期余额减上期余额自动计算，不能手动修改');
      flows.set(key, text); reviewed.delete(key); const number = flowNumber(text);
      if (number !== null) next.set(p.sheet, `I${p.row}`, number);
    }
    return new MonthlyBatch(this.original, next, this.inputs, reviewed, new Set(this.touched), true, flows);
  }
  check(keys: string[], checked: boolean): MonthlyBatch {
    const reviewed = new Set(this.reviewed), invalid = new Set(this.invalid);
    for (const key of keys) { if (checked && !invalid.has(key)) reviewed.add(key); else reviewed.delete(key); }
    return new MonthlyBatch(this.original, this.book, this.inputs, reviewed, this.touched, this.dirty, this.flows);
  }
  apply(action: (next: MonthlyWorkbook) => void, touchedKey?: string): MonthlyBatch {
    if (this.invalid.length) throw new Error('请先修正表格中的无效余额或净投入，再编辑产品或买卖记录');
    const next = this.book.clone(); action(next);
    const before = this.book.products(), after = next.products();
    const structural = before.length !== after.length || before.some((p, i) => productKey(p) !== productKey(after[i]));
    // Row insertion/deletion shifts Excel addresses; require a fresh review instead of reusing stale marks.
    const reviewed = structural ? new Set<string>() : new Set(this.reviewed);
    const touched = structural ? new Set<string>() : new Set(this.touched);
    if (touchedKey && !structural) { touched.add(touchedKey); reviewed.delete(touchedKey); }
    return new MonthlyBatch(this.original, next, new Map(), reviewed, touched, true);
  }
  changedKeys(): Set<string> {
    const counts = new Map<string, number>();
    for (const p of this.original.products()) counts.set(signature(p), (counts.get(signature(p)) || 0) + 1);
    const changed = new Set(this.touched);
    for (const p of this.book.products()) {
      const key = signature(p), count = counts.get(key) || 0;
      if (count) counts.set(key, count - 1); else changed.add(productKey(p));
    }
    for (const key of this.invalid) changed.add(key);
    return changed;
  }
}
