import JSZip from 'jszip';
import { isCashAccount, normalizeProductCategory } from './categories';
import { DOMParser, XMLSerializer } from '@xmldom/xmldom';
import { FormulaEngine, Scalar, letters, column, serialDate, isoDate } from './formula';
import { cashFlowSummary, validateTransactions } from './transactions';

const NS = 'http://schemas.openxmlformats.org/spreadsheetml/2006/main';
const children = (node: any, name: string): any[] => Array.from(node.childNodes || []).filter((x: any) => x.localName === name);
const first = (node: any, name: string): any => children(node, name)[0];
const descendants = (node: any, name: string): any[] => Array.from(node.getElementsByTagNameNS('*', name));
const parse = (s: string): any => new DOMParser().parseFromString(s.replace(/^\uFEFF/, ''), 'application/xml');
const xml = (d: any) => new XMLSerializer().serializeToString(d);
const quote = (s: string) => `'${s.replace(/'/g, "''")}'`;
export interface Sheet { name: string; path: string; doc: any; cells: Map<string, any>; }
export interface Product { sheet: string; row: number; name: string; account: string; category: string; sourceCategory?: string; currency: string; member: string; balance: number; previous: number; flow: Scalar; due: string; note: string; block?: Block; }
export interface Block { sheet: string; start: number; end: number; summary: number; sourceRows?: number[]; shared?: boolean; }
export interface Transaction { row?: number; date: string; amount: number; shares: number; price: number; kind: 'buy' | 'sell' | 'dividend'; }

// Only A1 references outside quoted Excel string literals are rewritten.
export function rewriteReferences(formula: string, context: string, target: string, at: number, count: number, remove = false): string {
  if (remove) formula = formula.replace(/\b(SUM|AVERAGE|COUNT|COUNTA)\(([^()]*)\)/g, (all, fn, list) => {
    const refs = list.split(','); const kept = refs.filter((ref: string) => { const m = ref.trim().match(/^(?:(?:'((?:[^']|'')+)'|([A-Za-z_][\w.]*))!)?\$?[A-Z]{1,3}\$?(\d+)$/); return !m || (m[1] || m[2] || context).replace(/''/g, "'") !== target || +m[3] < at || +m[3] >= at + count; });
    return kept.length === refs.length ? all : kept.length ? `${fn}(${kept.join(',')})` : '0';
  });
  return formula.split(/("(?:[^"]|"")*")/g).map((part, i) => i % 2 ? part : part.replace(/(?:(?:'((?:[^']|'')+)'|([A-Za-z_][\w.]*))!)?(\$?[A-Z]{1,3}\$?)(\d+)(?::(\$?[A-Z]{1,3}\$?)(\d+))?(?![\w(])/g, (all, quoted, plain, c1, r1, c2, r2) => {
    const name = (quoted || plain || context).replace(/''/g, "'"); if (name !== target) return all;
    const prefix = quoted ? `${quote(name)}!` : plain ? `${plain}!` : '';
    const shift = (r: number) => remove ? r >= at + count ? r - count : r : r >= at ? r + count : r;
    if (!c2) { if (remove && +r1 >= at && +r1 < at + count) return '0'; return `${prefix}${c1}${shift(+r1)}`; }
    let a = +r1, b = +r2;
    if (remove) { const survivors: number[] = []; if (a < at) survivors.push(a); if (b >= at + count) survivors.push(shift(b)); else if (b < at) survivors.push(b); if (a >= at + count) survivors.push(shift(a)); else if (a >= at && b >= at + count) survivors.push(at); if (!survivors.length) return '0'; a = Math.min(...survivors); b = Math.max(...survivors); if (+r1 < at && +r2 >= at && +r2 < at + count) b = at - 1; }
    else { a = shift(a); b = shift(b); }
    return `${prefix}${c1}${a}:${c2}${b}`;
  })).join('');
}

export class MonthlyWorkbook {
  sheets: Sheet[] = [];
  engine: FormulaEngine;
  private shared: string[] = [];
  private extras = new Map<string, any>();
  private constructor(private zip: JSZip) { this.engine = new FormulaEngine((s, a) => this.cell(s, a)); }
  clone(): MonthlyWorkbook {
    // The archive is immutable; edits and export use separate XML documents/archives.
    const next = new MonthlyWorkbook(this.zip);
    next.shared = [...this.shared];
    next.sheets = this.sheets.map(s => ({ ...s, doc: s.doc.cloneNode(true), cells: new Map() }));
    next.extras = new Map([...this.extras].map(([path, doc]) => [path, doc.cloneNode(true)]));
    next.reindex(); return next;
  }
  static async open(data: ArrayBuffer | Uint8Array): Promise<MonthlyWorkbook> {
    if (data.byteLength > 10 * 1024 * 1024) throw new Error('文件不能超过 10MB');
    const zip = await JSZip.loadAsync(data); const book = new MonthlyWorkbook(zip);
    if (Object.values(zip.files).reduce((s, f: any) => s + (f._data?.uncompressedSize || 0), 0) > 80 * 1024 * 1024) throw new Error('解压后文件过大');
    const read = async (p: string) => { const f = zip.file(p); if (!f) throw new Error(`Excel 缺少 ${p}`); return f.async('string'); };
    const wb = parse(await read('xl/workbook.xml')), rels = parse(await read('xl/_rels/workbook.xml.rels'));
    const relationships = new Map(descendants(rels, 'Relationship').map((r: any) => [r.getAttribute('Id'), r.getAttribute('Target')]));
    const shared = zip.file('xl/sharedStrings.xml');
    if (shared) book.shared = descendants(parse(await shared.async('string')), 'si').map(x => descendants(x, 't').map(t => t.textContent).join(''));
    for (const s of descendants(wb, 'sheet')) {
      const id = s.getAttributeNS('http://schemas.openxmlformats.org/officeDocument/2006/relationships', 'id');
      const target = String(relationships.get(id) || ''); const path = target.startsWith('/') ? target.slice(1) : `xl/${target.replace(/^\.\//, '')}`;
      const doc = parse(await read(path));
      const masters = new Map<string, { address: string; formula: string }>();
      for (const f of descendants(doc, 'f')) if (f.getAttribute('t') === 'shared' && f.textContent) masters.set(f.getAttribute('si'), { address: f.parentNode.getAttribute('r'), formula: f.textContent });
      for (const f of descendants(doc, 'f')) if (f.getAttribute('t') === 'shared') {
        if (!f.textContent) {
          const master = masters.get(f.getAttribute('si')); if (!master) throw new Error('共享公式缺少主公式');
          const a = master.address.match(/([A-Z]+)(\d+)/)!, b = f.parentNode.getAttribute('r').match(/([A-Z]+)(\d+)/)!;
          const dc = column(b[1]) - column(a[1]), dr = +b[2] - +a[2];
          f.textContent = master.formula.split(/("(?:[^"]|"")*")/g).map((part, i) => i % 2 ? part : part.replace(/(\$?)([A-Z]{1,3})(\$?)(\d+)(?![\w(])/g, (_all, ca, col, ra, row) => `${ca}${letters(column(col) + (ca ? 0 : dc))}${ra}${+row + (ra ? 0 : dr)}`)).join('');
        }
        f.removeAttribute('t'); f.removeAttribute('si'); f.removeAttribute('ref');
      }
      if (descendants(doc, 'sheetProtection').length) throw new Error('请先解除工作表保护再导入');
      book.sheets.push({ name: s.getAttribute('name'), path, doc, cells: new Map() });
    }
    book.extras.set('xl/workbook.xml', wb);
    for (const path of Object.keys(zip.files).filter(p => /charts\/.*\.xml$/.test(p))) book.extras.set(path, parse(await read(path)));
    book.reindex(); book.applyCashAccountRules(); book.validate(); return book;
  }
  validate() {
    for (const name of ['Assets', 'XIRR', 'Liabilities', 'Analyze', 'WTH', 'XIRR-WTH']) if (!this.sheets.some(s => s.name === name)) throw new Error(`模板不匹配：缺少 ${name} 工作表`);
    for (const s of ['Assets', 'WTH']) if (this.value(s, 'D2') !== 'Product' || this.value(s, 'E2') !== 'Current Balance') throw new Error('模板表头不匹配');
    if (!this.cell('Analyze', 'O3')?.formula) throw new Error('模板缺少家庭汇总公式');
    for (const s of this.sheets) for (const a of s.cells.keys()) if (this.cell(s.name, a)?.formula) {
      const v = this.value(s.name, a);
      if (typeof v === 'string' && /^#(?:UNSUPPORTED|PARSE|NAME\?|CYCLE|RANGE|REF)/.test(v)) throw new Error(`无法计算 ${s.name}!${a}：${v}。请使用已支持的月度模板，原文件未修改。`);
    }
  }
  sheet(name: string): Sheet { const s = this.sheets.find(x => x.name === name); if (!s) throw new Error(`工作表不存在：${name}`); return s; }
  reindex() { for (const s of this.sheets) s.cells = new Map(descendants(s.doc, 'c').map(c => [c.getAttribute('r'), c])); this.engine.clear(); }
  cell(sheet: string, address: string) {
    const node = this.sheets.find(s => s.name === sheet)?.cells.get(address); if (!node) return undefined;
    const f = first(node, 'f'), v = first(node, 'v'), type = node.getAttribute('t'); let value: Scalar = v?.textContent ?? null;
    if (type === 's') value = this.shared[Number(value)] ?? '';
    else if (type === 'inlineStr') value = descendants(node, 't').map(t => t.textContent).join('');
    else if (type === 'b') value = value === '1';
    else if (type !== 'str' && type !== 'e' && value !== null) value = Number(value);
    return { value, formula: f?.textContent || undefined };
  }
  value(sheet: string, address: string): Scalar { return this.engine.get(sheet, address); }
  number(sheet: string, address: string): number { const v = this.value(sheet, address); return typeof v === 'number' ? v : 0; }
  rateAddress(currency: 'USD' | 'HKD', previous = false): string {
    for (const address of this.sheet('Assets').cells.keys()) {
      if (!/^A\d+$/.test(address) || this.value('Assets', address) !== 'Assets') continue;
      const row = address.slice(1);
      if (this.value('Assets', `B${row}`) === `in ${currency}`) return `${previous ? 'H' : 'D'}${row}`;
    }
    throw new Error(`模板缺少 ${currency} 汇率分区`);
  }
  exchangeRate(currency: string): number {
    if (currency === 'RMB') return 1;
    try { return this.number('Assets', this.rateAddress(currency as 'USD' | 'HKD')); } catch { return 0; }
  }
  private element(doc: any, name: string, text?: string) { const node = doc.createElementNS(NS, name); if (text !== undefined) node.appendChild(doc.createTextNode(text)); return node; }
  node(sheet: string, address: string): any {
    const s = this.sheet(sheet); let c = s.cells.get(address); if (c) return c;
    const r = Number(address.match(/\d+/)![0]), data = descendants(s.doc, 'sheetData')[0]; let row = children(data, 'row').find(n => Number(n.getAttribute('r')) === r);
    if (!row) { row = this.element(s.doc, 'row'); row.setAttribute('r', String(r)); const after = children(data, 'row').find(n => Number(n.getAttribute('r')) > r); data.insertBefore(row, after || null); }
    c = this.element(s.doc, 'c'); c.setAttribute('r', address);
    const after = children(row, 'c').find(n => column(n.getAttribute('r').match(/[A-Z]+/)[0]) > column(address.match(/[A-Z]+/)![0])); row.insertBefore(c, after || null); s.cells.set(address, c); return c;
  }
  set(sheet: string, address: string, value: Scalar, formula?: string) {
    const c = this.node(sheet, address), doc = this.sheet(sheet).doc; while (c.firstChild) c.removeChild(c.firstChild); c.removeAttribute('t');
    if (formula) { const f = this.element(doc, 'f', formula.replace(/^=/, '')); if (/_xlfn\.VSTACK|PRODUCT\([^)]*\+/.test(formula)) { f.setAttribute('t', 'array'); f.setAttribute('ref', address); } c.appendChild(f); }
    if (typeof value === 'string') { c.setAttribute('t', formula ? 'str' : 'inlineStr'); if (formula) c.appendChild(this.element(doc, 'v', value)); else { const is = this.element(doc, 'is'), t = this.element(doc, 't', value); t.setAttribute('xml:space', 'preserve'); is.appendChild(t); c.appendChild(is); } }
    else if (value !== null) { if (typeof value === 'boolean') c.setAttribute('t', 'b'); c.appendChild(this.element(doc, 'v', String(typeof value === 'boolean' ? Number(value) : value))); }
    this.engine.clear();
  }
  formula(s: string, a: string, f: string) { this.set(s, a, null, f); }
  products(): Product[] {
    const out: Product[] = [];
    for (const s of this.sheets.filter(x => ['Assets', 'WTH'].includes(x.name))) {
      let currency = 'RMB', category = '', account = '';
      const rows = [...new Set([...s.cells.keys()].map(a => +a.replace(/[A-Z]+/, '')))].sort((a, b) => a - b);
      for (const row of rows) {
        const val = (c: string) => this.value(s.name, `${c}${row}`);
        if (val('A') === 'Assets') { currency = String(val('B')).replace('in ', ''); category = ''; account = ''; }
        const b = val('B'), c = val('C'), name = val('D');
        if (b && b !== 'Sub Total' && b !== 'Category') category = String(b).trim();
        if (c && c !== 'Sub Total' && c !== 'Account' && c !== 'Grand Total' && c !== 'Exchange Rate:') account = String(c);
        if (typeof name !== 'string' || !name || name === 'Product' || row < 3 || !category || /Exchange Rate/.test(String(c))) continue;
        const product: Product = { sheet: s.name, row, name, account, category: normalizeProductCategory(category), sourceCategory: category, currency, member: s.name === 'Assets' ? '本人' : 'WTH', balance: this.number(s.name, `E${row}`), previous: this.number(s.name, `H${row}`), flow: val('I'), due: isoDate(val('G')), note: String(val('N') || '') };
        product.block = this.blockFor(product); out.push(product);
      }
    }
    return out;
  }
  blocks(sheet: string): Block[] {
    const s = this.sheet(sheet), out: Block[] = [];
    const starts = [...s.cells.keys()].filter(a => /^C\d+$/.test(a)).map(a => +a.slice(1)).filter(r => { const v = this.value(sheet, `C${r}`); return typeof v === 'string' && v !== 'Product' && v !== 'XIRR:' && v !== ''; }).sort((a, b) => a - b);
    for (const start of starts) {
      let summary = start + 1;
      while (summary < start + 1000 && this.value(sheet, `C${summary}`) !== 'XIRR:') { if (starts.includes(summary)) break; summary++; }
      if (this.value(sheet, `C${summary}`) !== 'XIRR:') throw new Error(`无法识别 ${sheet} 的产品交易区块`);
      const last = summary - 1; const isTerminal = Boolean(this.cell(sheet, `D${last}`)?.formula?.includes('Assets!')) || Boolean(this.cell(sheet, `E${last}`)?.formula?.match(/(?:Assets|WTH)!E/));
      out.push({ sheet, start, end: isTerminal ? last : summary, summary });
    }
    return out;
  }
  blockFor(p: Product): Block | undefined {
    const sheet = p.sheet === 'Assets' ? 'XIRR' : 'XIRR-WTH';
    const direct = this.cell(p.sheet, `K${p.row}`)?.formula?.match(/^(?:'([^']+)'|([\w-]+))!E(\d+)$/);
    if (direct) return this.blocks(sheet).find(b => b.summary === +direct[3]);
    const formula = this.cell(p.sheet, `K${p.row}`)?.formula || '';
    const part = formula.match(/XIRR!\$?E\$?(\d+)(?::\$?E\$?(\d+))?/);
    if (part) { const block = this.blocks(sheet).find(b => +part[1] >= b.start && +(part[2] || part[1]) < b.end); if (block) { const sourceRows: number[] = []; for (let r = +part[1]; r <= +(part[2] || part[1]); r++) sourceRows.push(r); return { ...block, sourceRows, shared: true }; } }
    return undefined;
  }
  transactions(block: Block): Transaction[] {
    const rows: Transaction[] = [];
    for (let row = block.start; row < block.end; row++) {
      if (block.sourceRows && !block.sourceRows.includes(row)) continue;
      const amount = this.number(block.sheet, `E${row}`), shares = this.number(block.sheet, `F${row}`);
      if (!this.value(block.sheet, `D${row}`) && amount === 0 && shares === 0) continue;
      rows.push({ row, date: isoDate(this.value(block.sheet, `D${row}`)), amount: Math.abs(amount), shares: Math.abs(shares), price: this.number(block.sheet, `G${row}`), kind: shares === 0 && amount < 0 ? 'dividend' : amount < 0 ? 'sell' : 'buy' });
    }
    return rows;
  }
  private shiftRows(sheet: string, at: number, count: number, remove = false) {
    for (const s of this.sheets) {
      for (const f of descendants(s.doc, 'f')) { f.textContent = rewriteReferences(f.textContent, s.name, sheet, at, count, remove); if (s.name === sheet && f.hasAttribute('ref')) f.setAttribute('ref', rewriteReferences(f.getAttribute('ref'), sheet, sheet, at, count, remove)); }
    }
    for (const [path, doc] of this.extras) {
      const names = path === 'xl/workbook.xml' ? ['definedName'] : ['f'];
      for (const name of names) for (const f of descendants(doc, name)) f.textContent = rewriteReferences(f.textContent, '', sheet, at, count, remove);
    }
    const s = this.sheet(sheet), data = descendants(s.doc, 'sheetData')[0];
    for (const row of children(data, 'row')) {
      const r = Number(row.getAttribute('r'));
      if (remove && r >= at && r < at + count) { data.removeChild(row); continue; }
      if (r >= at + (remove ? count : 0)) { const nr = r + (remove ? -count : count); row.setAttribute('r', String(nr)); for (const c of children(row, 'c')) c.setAttribute('r', c.getAttribute('r').replace(/\d+/, String(nr))); }
    }
    for (const name of ['mergeCell', 'dimension', 'autoFilter', 'conditionalFormatting', 'dataValidation', 'hyperlink']) for (const n of descendants(s.doc, name)) {
      for (const attr of ['ref', 'sqref']) if (n.hasAttribute(attr)) { const ref = rewriteReferences(n.getAttribute(attr), sheet, sheet, at, count, remove); if (ref === '0') n.parentNode.removeChild(n); else n.setAttribute(attr, ref); }
    }
    this.reindex();
  }
  private copyStyle(sheet: string, sourceRow: number, targetRow: number, width: number) {
    for (let i = 1; i <= width; i++) { const c = this.sheet(sheet).cells.get(`${letters(i)}${sourceRow}`), target = this.node(sheet, `${letters(i)}${targetRow}`); if (c?.hasAttribute('s')) target.setAttribute('s', c.getAttribute('s')); }
  }
  addProduct(anchor: Product, name: string, account: string): Product {
    if (!name.trim() || !account.trim()) throw new Error('请填写产品名称和账户');
    const at = anchor.row; this.shiftRows(anchor.sheet, at, 1); this.copyStyle(anchor.sheet, at + 1, at, 14);
    for (const [c, v] of [['B', anchor.sourceCategory || anchor.category], ['C', account.trim()], ['D', name.trim()], ['E', 0], ['H', 0], ['I', 0], ['N', '']] as Array<[string, Scalar]>) this.set(anchor.sheet, `${c}${at}`, v);
    for (const c of ['F', 'J']) { const f = this.cell(anchor.sheet, `${c}${at + 1}`)?.formula; if (f) this.formula(anchor.sheet, `${c}${at}`, f.replace(new RegExp(`(?<![0-9])${at + 1}(?![0-9])`, 'g'), String(at))); }
    this.formula(anchor.sheet, `J${at}`, `E${at}-H${at}-I${at}`);
    // Inserting at the beginning of a group puts the new row outside an old range's start.
    for (const s of this.sheets) for (const f of descendants(s.doc, 'f')) {
      f.textContent = f.textContent.split(/("(?:[^"]|"")*")/g).map((part, i) => i % 2 ? part : part.replace(/(?:(?:'((?:[^']|'')+)'|([A-Za-z_][\w.]*))!)?(\$?[A-Z]{1,3}\$?)(\d+):(\$?[A-Z]{1,3}\$?\d+)/g, (all, quoted, plain, col, row, end) => {
        if ((quoted || plain || s.name).replace(/''/g, "'") !== anchor.sheet || +row !== at + 1) return all;
        return `${quoted ? `${quote(quoted)}!` : plain ? `${plain}!` : ''}${col}${at}:${end}`;
      })).join('');
      f.textContent = f.textContent.replace(/\b(SUM|AVERAGE|COUNT|COUNTA)\(([^()]*)\)/g, (_all, fn, list) => `${fn}(${list.split(',').map((ref: string) => {
        const m = ref.trim().match(/^(?:(?:'((?:[^']|'')+)'|([A-Za-z_][\w.]*))!)?(\$?[A-Z]{1,3}\$?)(\d+)$/);
        if (!m || (m[1] || m[2] || s.name).replace(/''/g, "'") !== anchor.sheet || +m[4] !== at + 1) return ref;
        const prefix = m[1] ? `${quote(m[1])}!` : m[2] ? `${m[2]}!` : '';
        return `${prefix}${m[3]}${at},${ref}`;
      }).join(',')})`);
    }
    this.reindex();
    const product = this.products().find(p => p.sheet === anchor.sheet && p.row === at)!;
    this.cashAccountFlow(product);
    this.createEmptyBlock(product, this.products().find(p => p.sheet === anchor.sheet && p.row === at + 1));
    return this.products().find(p => p.sheet === anchor.sheet && p.row === at)!;
  }
  private createEmptyBlock(p: Product, reference?: Product) {
    const xs = p.sheet === 'Assets' ? 'XIRR' : 'XIRR-WTH';
    const anchor = reference?.block && !reference.block.shared ? reference : this.products().find(x => x.sheet === p.sheet && x.row !== p.row && x.currency === p.currency && x.category === p.category && x.account === p.account && x.block && !x.block.shared);
    let start: number;
    if (anchor?.block) start = anchor.block.start;
    else {
      const sections = [...this.sheet(xs).cells.keys()].filter(a => /^A\d+$/.test(a) && this.value(xs, a) === 'Assets').map(a => +a.slice(1)).sort((a, b) => a - b);
      const section = sections.find(r => this.value(xs, `B${r}`) === `in ${p.currency}`);
      const next = section === undefined ? undefined : sections.find(r => r > section);
      if (section === undefined && sections.length) throw new Error('XIRR 模板中没有此币种分区');
      start = next ? next - 1 : Math.max(2, ...[...this.sheet(xs).cells.keys()].filter(a => { const c = this.cell(xs, a); return c?.value !== null || c.formula; }).map(a => +a.replace(/[A-Z]+/, ''))) + 2;
    }
    const oldSummary = anchor?.block?.summary;
    this.shiftRows(xs, start, 4);
    if (anchor?.block) { this.set(xs, `B${anchor.block.start + 4}`, anchor.account); }
    const end = start + 1, summary = start + 2;
    for (let r = start; r <= summary; r++) this.copyStyle(xs, 3, r, 9);
    this.set(xs, `B${start}`, p.account); this.set(xs, `C${start}`, p.name);
    for (const c of ['E', 'F', 'G', 'H', 'I']) this.set(xs, `${c}${start}`, 0);
    this.formula(xs, `D${end}`, 'Assets!$L$1'); this.formula(xs, `E${end}`, `${p.sheet}!E${p.row}`); this.formula(xs, `F${end}`, `F${start}`);
    this.set(xs, `C${summary}`, 'XIRR:'); this.set(xs, `E${summary}`, 'No transactions'); this.set(xs, `F${summary}`, 'annualized TWR:'); this.set(xs, `G${summary}`, 'No transactions'); this.set(xs, `H${summary}`, 'Principle:'); this.set(xs, `I${summary}`, 0);
    for (const [col, source] of [['K', `E${summary}`], ['L', `G${summary}`]]) this.formula(p.sheet, `${col}${p.row}`, `${quote(xs)}!${source}`);
    if (oldSummary) for (const [a, node] of this.sheet(xs).cells) {
      if (!/^[EGI]\d+$/.test(a)) continue;
      const row = a.replace(/[A-Z]+/, ''); if (this.value(xs, `B${row}`) !== 'Simple mean') continue;
      const f = first(node, 'f'); if (!f) continue;
      const col = a[0], original = col === 'I' ? oldSummary + 3 : oldSummary + 4, added = col === 'I' ? end : summary;
      f.textContent = f.textContent.replace(new RegExp(`\\b${col}${original}\\b`, 'g'), `${col}${added},${col}${original}`);
    }
    this.reindex();
  }
  private splitShared(p: Product): Product {
    const shared = p.block; if (!shared?.shared) return p;
    const related = this.products().filter(x => x.block?.shared && x.block.sheet === shared.sheet && x.block.summary === shared.summary);
    const snapshots = related.map(x => ({ product: x, trades: this.transactions(x.block!) }));
    // Split the known account-specific purchase ranges into independent product blocks.
    for (const { product, trades } of snapshots) { this.set(product.sheet, `K${product.row}`, null); this.saveTransactions({ ...product, block: undefined }, trades); }
    this.shiftRows(shared.sheet, shared.start, shared.summary - shared.start + 1, true);
    return this.products().find(x => x.sheet === p.sheet && x.row === p.row)!;
  }
  updateProduct(p: Product, values: { name: string; account: string; balance: number; previous: number; flow: number | string; due: string; note: string }) {
    if (!values.name.trim() || !values.account.trim() || !Number.isFinite(values.balance) || values.balance < 0 || !Number.isFinite(values.previous) || values.previous < 0) throw new Error('产品名称、账户或余额无效');
    const due = values.due ? serialDate(values.due) : null;
    // Make inherited account/category explicit before editing, so following rows retain their identity.
    const following = this.products().find(x => x.sheet === p.sheet && x.row > p.row);
    if (following && !this.cell(p.sheet, `C${following.row}`)?.value) this.set(p.sheet, `C${following.row}`, following.account);
    for (const [c, v] of [['C', values.account], ['D', values.name], ['E', values.balance], ['H', values.previous], ['I', values.flow], ['G', due], ['N', values.note]] as Array<[string, Scalar]>) this.set(p.sheet, `${c}${p.row}`, v);
    if (p.block && !p.block.shared) { this.set(p.block.sheet, `B${p.block.start}`, values.account); this.set(p.block.sheet, `C${p.block.start}`, values.name); }
    this.cashAccountFlow(p);
  }
  deleteProduct(p: Product) {
    if (p.block?.shared) p = this.splitShared(p);
    const block = p.block;
    const combined = this.blocks(p.sheet === 'Assets' ? 'XIRR' : 'XIRR-WTH').some(b => (this.cell(b.sheet, `E${b.end}`)?.formula || '').includes(`${p.sheet}!E${p.row}`));
    if (combined && !block) throw new Error('此产品使用跨账户合并流水，请先在 Excel 中拆分关联区块后再删除');
    const next = this.products().find(x => x.sheet === p.sheet && x.row > p.row);
    if (next) { this.set(next.sheet, `B${next.row}`, next.sourceCategory || next.category); this.set(next.sheet, `C${next.row}`, next.account); }
    if (block) this.shiftRows(block.sheet, block.start, block.summary - block.start + 1, true);
    this.shiftRows(p.sheet, p.row, 1, true);
  }
  saveTransactions(p: Product, transactions: Transaction[]) {
    const endDate = this.number('Assets', 'L1');
    const remaining = validateTransactions(transactions, endDate);
    if (p.block?.shared) p = this.splitShared(p);
    const xs = p.sheet === 'Assets' ? 'XIRR' : 'XIRR-WTH'; let b = p.block;
    if (!b && this.cell(p.sheet, `K${p.row}`)?.formula) throw new Error('该产品使用跨账户收益公式，需先在 Excel 拆分流水后编辑');
    if (!b) { this.createEmptyBlock(p); b = this.blockFor(p); }
    let start: number;
    if (b) {
      start = b.start; const old = b.summary - b.start + 1, required = transactions.length + 2;
      if (required > old) this.shiftRows(xs, b.end, required - old);
      else if (required < old) this.shiftRows(xs, start + transactions.length, old - required, true);
    } else { start = Math.max(2, ...this.blocks(xs).map(x => x.summary)) + 2; }
    const end = start + transactions.length, summary = end + 1;
    const oldBalance = this.number(p.sheet, `E${p.row}`);
    for (let r = start; r <= summary; r++) { this.copyStyle(xs, 3, r, 9); for (const c of ['B', 'C', 'D', 'E', 'F', 'G', 'H', 'I']) this.set(xs, `${c}${r}`, null); }
    this.set(xs, `B${start}`, p.account); this.set(xs, `C${start}`, p.name);
    transactions.forEach((t, i) => {
      const r = start + i, prev = r - 1, sign = t.kind === 'buy' ? 1 : -1;
      this.set(xs, `D${r}`, serialDate(t.date)); this.set(xs, `E${r}`, sign * t.amount); this.set(xs, `F${r}`, t.kind === 'dividend' ? 0 : sign * t.shares);
      this.set(xs, `G${r}`, t.price);
      if (i === 0) { this.set(xs, `H${r}`, 0); this.set(xs, `I${r}`, 0); }
      else { this.formula(xs, `H${r}`, t.kind === 'dividend' ? `(G${r}-E${r}/SUM(F${start}:F${prev}))/G${prev}-1` : `G${r}/G${prev}-1`); this.formula(xs, `I${r}`, `IF(D${r}=D${prev},I${prev},POWER(1+H${r},365/(D${r}-D${prev}))-1)`); }
    });
    this.formula(xs, `D${end}`, 'Assets!$L$1'); this.formula(xs, `E${end}`, `${p.sheet}!E${p.row}`); this.formula(xs, `F${end}`, `SUM(F${start}:F${end - 1})`);
    this.formula(xs, `G${end}`, `IF(F${end}=0,G${end - 1},E${end}/F${end})`); this.formula(xs, `H${end}`, `IF(F${end}=0,0,G${end}/G${end - 1}-1)`);
    this.formula(xs, `I${end}`, `IF(F${end}=0,I${end - 1},IF(D${end}=D${end - 1},I${end - 1},POWER(1+H${end},365/(D${end}-D${end - 1}))-1))`);
    this.set(xs, `C${summary}`, 'XIRR:'); this.formula(xs, `E${summary}`, `XIRR(_xlfn.VSTACK(-E${start}:E${end - 1},E${end}),D${start}:D${end})`);
    this.set(xs, `F${summary}`, 'annualized TWR:'); this.formula(xs, `G${summary}`, `POWER(PRODUCT(H${start}:H${end}+1),365/(IF(F${end}=0,D${end - 1},D${end})-D${start}))-1`);
    this.set(xs, `H${summary}`, 'Principle:'); this.formula(xs, `I${summary}`, `SUM(E${start}:E${end - 1})`);
    this.formula(p.sheet, `K${p.row}`, `${quote(xs)}!E${summary}`); this.formula(p.sheet, `L${p.row}`, `${quote(xs)}!G${summary}`); this.formula(p.sheet, `M${p.row}`, `${quote(xs)}!I${end}`);
    const previous = this.number('Assets', 'N1'); const flow = cashFlowSummary(transactions, previous, endDate).net;
    this.set(p.sheet, `I${p.row}`, flow);
    this.formula(p.sheet, `J${p.row}`, `E${p.row}-H${p.row}-I${p.row}`);
    if (!isCashAccount(p.category) && Math.abs(remaining) < 1e-7) this.set(p.sheet, `E${p.row}`, 0); else this.set(p.sheet, `E${p.row}`, oldBalance);
    this.cashAccountFlow(p); this.reindex();
  }
  rollover(date: string) {
    const current = this.number('Assets', 'L1'), next = serialDate(date); if (next <= current) throw new Error('新记账日期必须晚于上次');
    const values: Array<[string, string, Scalar]> = [];
    for (const s of ['Assets', 'WTH']) {
      values.push([s, 'H1', this.value(s, 'D1')]);
      for (const a of this.sheet(s).cells.keys()) if (/^H\d+$/.test(a) && a !== 'H1' && !this.cell(s, a)?.formula && typeof this.cell(s, a)?.value === 'number') values.push([s, a, this.value(s, a.replace('H', 'E'))]);
    }
    const liabilities = this.value('Liabilities', 'D1');
    for (const a of this.sheet('Liabilities').cells.keys()) if (/^H\d+$/.test(a) && !this.cell('Liabilities', a)?.formula && typeof this.cell('Liabilities', a)?.value === 'number') values.push(['Liabilities', a, this.value('Liabilities', a.replace('H', 'D'))]);
    for (const [s, a, v] of values) this.set(s, a, v);
    for (const s of ['Assets', 'WTH']) for (const a of this.sheet(s).cells.keys()) if (/^I\d+$/.test(a) && !this.cell(s, a)?.formula && typeof this.cell(s, a)?.value === 'number') this.set(s, a, 0);
    for (const currency of ['USD', 'HKD'] as const) this.set('Assets', this.rateAddress(currency, true), this.value('Assets', this.rateAddress(currency)));
    this.set('Liabilities', 'F1', liabilities); this.set('Assets', 'N1', current); this.set('Assets', 'L1', next); this.set('Analyze', 'C5', 0); this.set('Analyze', 'I5', 0);
  }
  private cashAccountFlow(p: Product) {
    if (!isCashAccount(p.category)) return;
    const formula = `E${p.row}-H${p.row}`;
    if (this.cell(p.sheet, `I${p.row}`)?.formula !== formula) this.formula(p.sheet, `I${p.row}`, formula);
  }
  applyCashAccountRules() { for (const p of this.products()) this.cashAccountFlow(p); }
  async export(): Promise<Uint8Array> {
    this.applyCashAccountRules();
    // Patch only XML parts we understand. Original styles, drawings and package relationships stay intact.
    const result = await JSZip.loadAsync(await this.zip.generateAsync({ type: 'uint8array' }));
    const serializer = new XMLSerializer();
    for (const s of this.sheets) {
      const doc = parse(serializer.serializeToString(s.doc));
      for (const c of descendants(doc, 'c')) if (first(c, 'f')) {
        const value = this.value(s.name, c.getAttribute('r')); const v = first(c, 'v'); if (v) c.removeChild(v);
        c.removeAttribute('t');
        if (typeof value === 'string') c.setAttribute('t', value.startsWith('#') ? 'e' : 'str');
        if (typeof value === 'boolean') c.setAttribute('t', 'b');
        if (value !== null) c.appendChild(this.element(doc, 'v', String(typeof value === 'boolean' ? Number(value) : value)));
      }
      result.file(s.path, xml(doc));
    }
    for (const [path, original] of this.extras) {
      const doc = parse(xml(original));
      if (path === 'xl/workbook.xml') { let calc = descendants(doc, 'calcPr')[0]; if (!calc) { calc = this.element(doc, 'calcPr'); doc.documentElement.appendChild(calc); } calc.setAttribute('calcMode', 'auto'); calc.setAttribute('fullCalcOnLoad', '1'); calc.setAttribute('forceFullCalc', '1'); }
      else for (const name of ['numCache', 'strCache']) for (const cache of descendants(doc, name)) { const formula = first(cache.parentNode, 'f')?.textContent; const m = formula?.match(/^(?:'([^']+)'|([\w-]+))!\$?([A-Z]+)\$?(\d+):\$?([A-Z]+)\$?(\d+)$/); if (!m) continue; while (cache.firstChild) cache.removeChild(cache.firstChild); const chartNode = (name: string, text?: string) => { const n = doc.createElementNS(cache.namespaceURI, `${cache.prefix ? `${cache.prefix}:` : ''}${name}`); if (text !== undefined) n.appendChild(doc.createTextNode(text)); return n; }; const count = chartNode('ptCount'); count.setAttribute('val', String(+m[6] - +m[4] + 1)); cache.appendChild(count); for (let r = +m[4]; r <= +m[6]; r++) { const pt = chartNode('pt'); pt.setAttribute('idx', String(r - +m[4])); pt.appendChild(chartNode('v', String(this.value(m[1] || m[2], `${m[3]}${r}`) ?? ''))); cache.appendChild(pt); } }
      result.file(path, xml(doc));
    }
    if (result.file('xl/calcChain.xml')) {
      result.remove('xl/calcChain.xml');
      for (const path of ['xl/_rels/workbook.xml.rels', '[Content_Types].xml']) {
        const file = result.file(path); if (!file) continue; const doc = parse(await file.async('string'));
        for (const node of [...descendants(doc, 'Relationship'), ...descendants(doc, 'Override')]) if (/calcChain/.test(node.getAttribute('Target') || node.getAttribute('PartName') || '')) node.parentNode.removeChild(node);
        result.file(path, xml(doc));
      }
    }
    return result.generateAsync({ type: 'uint8array', compression: 'DEFLATE' });
  }
}
