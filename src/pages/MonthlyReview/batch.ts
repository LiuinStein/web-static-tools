import { MonthlyWorkbook, Product } from './workbook';
import { isCashAccount } from './categories';

export const productKey = (p: Pick<Product, 'sheet' | 'row'>) => `${p.sheet}:${p.row}`;
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
export function balancePaste(visible: Array<Pick<Product, 'sheet' | 'row'>>, start: string, text: string): Array<[string, string]> {
  const lines = text.replace(/\r\n?/g, '\n').replace(/\n+$/, '').split('\n');
  const index = visible.findIndex(p => productKey(p) === start);
  if (index < 0 || index + lines.length > visible.length) throw new Error('粘贴行数超出当前可见行范围，请核对筛选条件和起始行');
  if (lines.some(line => line.includes('\t'))) throw new Error('请只复制一列余额，不要包含产品名称或其他列');
  if (lines.some(line => balanceNumber(line) === null)) throw new Error('粘贴内容含空白、负数或无效余额，本次粘贴未应用');
  return lines.map((line, i) => [productKey(visible[index + i]), line.trim()]);
}
const signature = (p: Product) => JSON.stringify([p.sheet, p.member, p.currency, p.category, p.account, p.name, p.balance, p.previous, p.flow, p.due, p.note]);

const rowCache = new WeakMap<MonthlyWorkbook, Map<string, Product | ReturnType<MonthlyWorkbook['liabilities']>[number]>>();
function batchRows(book: MonthlyWorkbook) {
  let rows = rowCache.get(book);
  if (!rows) { rows = new Map([...book.products(), ...book.liabilities()].map(p => [productKey(p), p])); rowCache.set(book, rows); }
  return rows;
}
const differenceCache = new WeakMap<MonthlyWorkbook, WeakMap<MonthlyWorkbook, Set<string>>>();

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
  stageBalances(changes: Array<[string, string]>): MonthlyBatch {
    const inputs = new Map(this.inputs), reviewed = new Set(this.reviewed), rows = batchRows(this.book);
    for (const [key, text] of changes) {
      if (!rows.has(key)) throw new Error('账户位置已变化，请重新选择');
      inputs.set(key, text); reviewed.delete(key);
    }
    return new MonthlyBatch(this.original, this.book, inputs, reviewed, this.touched, true, this.flows);
  }
  stageFlows(changes: Array<[string, string]>): MonthlyBatch {
    const flows = new Map(this.flows), reviewed = new Set(this.reviewed), rows = batchRows(this.book);
    for (const [key, text] of changes) {
      const p = rows.get(key);
      if (!p || !('category' in p)) throw new Error('产品位置已变化，请重新选择');
      if (isCashAccount(p.category)) throw new Error('活期账户净投入按本期余额减上期余额自动计算，不能手动修改');
      flows.set(key, text); reviewed.delete(key);
    }
    return new MonthlyBatch(this.original, this.book, this.inputs, reviewed, this.touched, true, flows);
  }
  // Typing only stages strings. Clone and invalidate formula caches once, when leaving a field or saving.
  commitInputs(): MonthlyBatch {
    const rows = batchRows(this.book), changes: Array<[string, string, number]> = [];
    for (const [key, text] of this.inputs) {
      const p = rows.get(key), number = balanceNumber(text);
      if (p && number !== null && number !== p.balance) changes.push([p.sheet, `${p.sheet === 'Liabilities' ? 'D' : 'E'}${p.row}`, number]);
    }
    for (const [key, text] of this.flows) {
      const p = rows.get(key), number = flowNumber(text);
      if (p && 'category' in p && number !== null && (number !== p.flow || this.book.cell(p.sheet, `I${p.row}`)?.formula)) changes.push([p.sheet, `I${p.row}`, number]);
    }
    if (!changes.length) return this;
    const next = this.book.clone();
    for (const [sheet, address, value] of changes) next.set(sheet, address, value);
    return new MonthlyBatch(this.original, next, this.inputs, this.reviewed, this.touched, this.dirty, this.flows);
  }
  balances(changes: Array<[string, string]>): MonthlyBatch { return this.stageBalances(changes).commitInputs(); }
  cashFlows(changes: Array<[string, string]>): MonthlyBatch { return this.stageFlows(changes).commitInputs(); }
  check(keys: string[], checked: boolean): MonthlyBatch {
    const current = this.commitInputs(), reviewed = new Set(current.reviewed), invalid = new Set(current.invalid);
    for (const key of keys) { if (checked && !invalid.has(key)) reviewed.add(key); else reviewed.delete(key); }
    return new MonthlyBatch(current.original, current.book, current.inputs, reviewed, current.touched, current.dirty, current.flows);
  }
  apply(action: (next: MonthlyWorkbook) => void, touchedKey?: string): MonthlyBatch {
    if (this.invalid.length) throw new Error('请先修正表格中的无效余额或净投入，再编辑账户或买卖记录');
    const next = this.commitInputs().book.clone(); action(next);
    const before = this.book.products(), after = next.products();
    const structural = before.length !== after.length || before.some((p, i) => productKey(p) !== productKey(after[i]));
    // Row insertion/deletion shifts Excel addresses; require a fresh review instead of reusing stale marks.
    const reviewed = structural ? new Set([...this.reviewed].filter(key => key.startsWith('Liabilities:'))) : new Set(this.reviewed);
    const touched = structural ? new Set([...this.touched].filter(key => key.startsWith('Liabilities:'))) : new Set(this.touched);
    if (touchedKey && !structural) { touched.add(touchedKey); reviewed.delete(touchedKey); }
    return new MonthlyBatch(this.original, next, new Map(), reviewed, touched, true);
  }
  changedKeys(): Set<string> {
    let cache = differenceCache.get(this.original);
    if (!cache) { cache = new WeakMap(); differenceCache.set(this.original, cache); }
    let base = cache.get(this.book);
    if (!base) {
      base = new Set<string>(); const counts = new Map<string, number>();
      for (const p of batchRows(this.original).values()) if ('category' in p) counts.set(signature(p), (counts.get(signature(p)) || 0) + 1);
      for (const p of batchRows(this.book).values()) {
        if ('repayment' in p) {
          const previous = batchRows(this.original).get(productKey(p));
          if (!previous || !('repayment' in previous) || p.balance !== previous.balance || p.repayment !== previous.repayment) base.add(productKey(p));
        } else {
          const key = signature(p), count = counts.get(key) || 0;
          if (count) counts.set(key, count - 1); else base.add(productKey(p));
        }
      }
      cache.set(this.book, base);
    }
    const changed = new Set([...base, ...this.touched]);
    for (const [key, text] of this.inputs) if (balanceNumber(text) !== batchRows(this.book).get(key)?.balance) changed.add(key);
    for (const [key, text] of this.flows) {
      const p = batchRows(this.book).get(key);
      if (p && 'category' in p && flowNumber(text) !== p.flow) changed.add(key);
    }
    return changed;
  }
}
