import JSZip from 'jszip';
import { isCashAccount, normalizeProductCategory } from './categories';
import { DOMParser, XMLSerializer } from '@xmldom/xmldom';
import { FormulaEngine, Scalar, letters, column, serialDate, isoDate } from './formula';
import { cashFlowSummary, validateTransactions } from './transactions';
import type { ProductGroup } from './product-entry';

const NS = 'http://schemas.openxmlformats.org/spreadsheetml/2006/main';
const REL_NS = 'http://schemas.openxmlformats.org/package/2006/relationships';
const DOCUMENT_REL_NS = 'http://schemas.openxmlformats.org/officeDocument/2006/relationships';
const CONFIG_SHEET = '_MR_Config';
const children = (node: any, name: string): any[] => Array.from(node.childNodes || []).filter((x: any) => x.localName === name);
const first = (node: any, name: string): any => children(node, name)[0];
const descendants = (node: any, name: string): any[] => Array.from(node.getElementsByTagNameNS('*', name));
const parse = (s: string): any => new DOMParser().parseFromString(s.replace(/^\uFEFF/, ''), 'application/xml');
const xml = (d: any) => new XMLSerializer().serializeToString(d);
const quote = (s: string) => `'${s.replace(/'/g, "''")}'`;
export interface Sheet { name: string; path: string; doc: any; cells: Map<string, any>; }
export interface Product { sheet: string; row: number; name: string; account: string; category: string; sourceCategory?: string; currency: string; member: string; balance: number; previous: number; flow: Scalar; due: string; note: string; block?: Block; }
export interface Liability { sheet: 'Liabilities'; row: number; account: string; balance: number; previous: number; repayment: Scalar; }
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
    next.reindex(); next.engine = this.engine.fork((sheet, address) => next.cell(sheet, address)); return next;
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
    book.extras.set('xl/_rels/workbook.xml.rels', rels);
    book.extras.set('[Content_Types].xml', parse(await read('[Content_Types].xml')));
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
  rateAddress(currency: string, previous = false): string {
    for (const address of this.sheet('Assets').cells.keys()) {
      if (!/^A\d+$/.test(address) || this.value('Assets', address) !== 'Assets') continue;
      const row = address.slice(1);
      if (this.value('Assets', `B${row}`) === `in ${currency}`) return `${previous ? 'H' : 'D'}${row}`;
    }
    throw new Error(`模板缺少 ${currency} 汇率分区`);
  }
  exchangeRate(currency: string): number {
    if (currency === 'RMB') return 1;
    try { return this.number('Assets', this.rateAddress(currency)); } catch { return 0; }
  }
  customProductGroups(): ProductGroup[] {
    const sheet = this.sheets.find(s => s.name === CONFIG_SHEET);
    if (!sheet) return [];
    if (this.value(CONFIG_SHEET, 'A1') !== 'Monthly review configuration v1') throw new Error('账本中存在同名配置表，请先重命名 _MR_Config 工作表');
    return [...sheet.cells.keys()].filter(a => /^A\d+$/.test(a) && +a.slice(1) >= 3).map(a => {
      const row = a.slice(1), member = String(this.value(CONFIG_SHEET, a) || ''), assetSheet = String(this.value(CONFIG_SHEET, `B${row}`) || '');
      const currency = String(this.value(CONFIG_SHEET, `D${row}`) || ''), category = String(this.value(CONFIG_SHEET, `E${row}`) || '');
      return { key: JSON.stringify([assetSheet, currency, category]), member, sheet: assetSheet, currency, category };
    }).filter(g => g.member && g.sheet && g.currency && g.category);
  }
  members(): Array<{ member: string; sheet: string; xirr: string }> {
    const members = [{ member: '本人', sheet: 'Assets', xirr: 'XIRR' }, { member: 'WTH', sheet: 'WTH', xirr: 'XIRR-WTH' }];
    for (const group of this.customProductGroups()) if (!members.some(m => m.sheet === group.sheet)) {
      const config = this.sheet(CONFIG_SHEET);
      const row = [...config.cells.keys()].find(a => /^B\d+$/.test(a) && this.value(CONFIG_SHEET, a) === group.sheet)!.slice(1);
      members.push({ member: group.member, sheet: group.sheet, xirr: String(this.value(CONFIG_SHEET, `C${row}`)) });
    }
    return members;
  }
  private xirrSheet(sheet: string): string {
    const member = this.members().find(m => m.sheet === sheet);
    if (!member) throw new Error('找不到成员对应的交易工作表');
    return member.xirr;
  }
  private currencySections(sheet: string): Array<{ currency: string; header: number; total: number }> {
    const rows = [...this.sheet(sheet).cells.keys()].filter(a => /^A\d+$/.test(a)).map(a => +a.slice(1)).sort((a, b) => a - b);
    const sections: Array<{ currency: string; header: number; total: number }> = [];
    for (const row of rows) {
      if (this.value(sheet, `A${row}`) === 'Assets') sections.push({ currency: String(this.value(sheet, `B${row}`)).replace(/^in /, ''), header: row, total: 0 });
      if (this.value(sheet, `A${row}`) === 'Grand Total' && sections.length) sections[sections.length - 1].total = row;
    }
    return sections;
  }
  currencyCodes(): string[] { return this.currencySections('Assets').map(s => s.currency); }
  private lastContentRow(sheet: string): number {
    return Math.max(2, ...[...this.sheet(sheet).cells.keys()].filter(a => { const cell = this.cell(sheet, a); return cell?.value !== null || cell?.formula; }).map(a => +a.replace(/[A-Z]+/, '')));
  }
  private addSheet(name: string, template?: string, hidden = false) {
    if (this.sheets.some(s => s.name === name)) throw new Error(`工作表 ${name} 已存在`);
    const wb = this.extras.get('xl/workbook.xml'), rels = this.extras.get('xl/_rels/workbook.xml.rels'), types = this.extras.get('[Content_Types].xml');
    const id = Math.max(0, ...descendants(wb, 'sheet').map(s => Number(s.getAttribute('sheetId')))) + 1;
    let part = id; while (this.zip.file(`xl/worksheets/sheet${part}.xml`) || this.sheets.some(s => s.path === `xl/worksheets/sheet${part}.xml`)) part++;
    let relId = `rIdMonthly${part}`; while (descendants(rels, 'Relationship').some(r => r.getAttribute('Id') === relId)) relId += 'x';
    const entry = this.element(wb, 'sheet'); entry.setAttribute('name', name); entry.setAttribute('sheetId', String(id)); entry.setAttributeNS(DOCUMENT_REL_NS, 'r:id', relId); if (hidden) entry.setAttribute('state', 'hidden');
    descendants(wb, 'sheets')[0].appendChild(entry);
    const rel = rels.createElementNS(REL_NS, 'Relationship'); rel.setAttribute('Id', relId); rel.setAttribute('Type', `${DOCUMENT_REL_NS}/worksheet`); rel.setAttribute('Target', `worksheets/sheet${part}.xml`); rels.documentElement.appendChild(rel);
    const type = types.createElementNS('http://schemas.openxmlformats.org/package/2006/content-types', 'Override'); type.setAttribute('PartName', `/xl/worksheets/sheet${part}.xml`); type.setAttribute('ContentType', 'application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml'); types.documentElement.appendChild(type);
    const doc = parse(`<worksheet xmlns="${NS}"><sheetData/></worksheet>`);
    if (template) for (const tag of ['sheetViews', 'sheetFormatPr', 'cols']) {
      const original = descendants(this.sheet(template).doc, tag)[0]; if (!original) continue;
      const node = doc.importNode(original, true);
      for (const view of descendants(node, 'sheetView')) { view.removeAttribute('tabSelected'); view.removeAttribute('topLeftCell'); }
      for (const child of [...descendants(node, 'selection'), ...descendants(node, 'pane')]) child.parentNode.removeChild(child);
      doc.documentElement.insertBefore(node, descendants(doc, 'sheetData')[0]);
    }
    this.sheets.push({ name, path: `xl/worksheets/sheet${part}.xml`, doc, cells: new Map() });
  }
  private copyRowFrom(source: string, sourceRow: number, target: string, targetRow: number, width: number, values = false) {
    for (let col = 1; col <= width; col++) {
      const from = `${letters(col)}${sourceRow}`, to = `${letters(col)}${targetRow}`, node = this.sheet(source).cells.get(from), cell = this.node(target, to);
      if (node?.hasAttribute('s')) cell.setAttribute('s', node.getAttribute('s'));
      if (values) this.set(target, to, this.value(source, from));
    }
  }
  ensureAssetGroup(values: { member: string; currency: string; category: string }, rate?: number): ProductGroup {
    let member = this.members().find(m => m.member === values.member);
    const isNewMember = !member;
    if (!member) {
      let suffix = 1; while (this.sheets.some(s => s.name === `Assets-M${suffix}` || s.name === `XIRR-M${suffix}`)) suffix++;
      member = { member: values.member, sheet: `Assets-M${suffix}`, xirr: `XIRR-M${suffix}` };
      this.addSheet(member.sheet, 'WTH'); this.addSheet(member.xirr, 'XIRR-WTH');
      this.copyRowFrom('WTH', 1, member.sheet, 1, 14, true); this.copyRowFrom('WTH', 2, member.sheet, 2, 14, true);
      this.set(member.sheet, 'H1', 0); this.formula(member.sheet, 'D1', 'E3'); this.formula(member.sheet, 'E1', 'E3'); this.formula(member.sheet, 'F1', 'IF(D1=0,0,E1/D1)'); this.formula(member.sheet, 'J1', 'D1-H1'); this.formula(member.sheet, 'L1', 'Assets!L1');
      this.set(member.sheet, 'M1', 'Last Accounting Time'); this.formula(member.sheet, 'N1', 'Assets!N1');
      this.set(member.sheet, 'O1', 'Est. investment income'); this.formula(member.sheet, 'P1', 'J3');
      this.set(member.sheet, 'O2', 'Member'); this.set(member.sheet, 'P2', values.member);
      this.copyRowFrom('WTH', this.currencySections('WTH')[0].total, member.sheet, 3, 14);
      this.set(member.sheet, 'A3', 'Grand Total'); for (const col of ['E', 'I', 'J']) this.formula(member.sheet, `${col}3`, '0'); this.set(member.sheet, 'H3', 0); this.set(member.sheet, 'F3', 1);
      this.copyRowFrom('XIRR-WTH', 1, member.xirr, 1, 9, true); this.copyRowFrom('XIRR-WTH', 2, member.xirr, 2, 9, true);
    }
    const group: ProductGroup = { ...values, sheet: member.sheet, key: JSON.stringify([member.sheet, values.currency, values.category]) };
    if (!this.customProductGroups().some(g => g.key === group.key)) {
      if (!this.sheets.some(s => s.name === CONFIG_SHEET)) {
        this.addSheet(CONFIG_SHEET, undefined, true); this.set(CONFIG_SHEET, 'A1', 'Monthly review configuration v1');
        ['Member', 'Asset sheet', 'XIRR sheet', 'Currency', 'Product type'].forEach((value, i) => this.set(CONFIG_SHEET, `${letters(i + 1)}2`, value));
      }
      const row = this.lastContentRow(CONFIG_SHEET) + 1;
      [values.member, member.sheet, member.xirr, values.currency, values.category].forEach((value, i) => this.set(CONFIG_SHEET, `${letters(i + 1)}${row}`, value));
    }
    this.ensureCurrency('Assets', values.currency, rate);
    this.ensureCurrency(member.sheet, values.currency, rate);
    if (isNewMember) {
      for (const [address, addition] of [['O2', `${quote(member.sheet)}!H1`], ['O3', `${quote(member.sheet)}!D1`], ['B1', `${quote(member.sheet)}!D1`], ['O7', `${quote(member.sheet)}!P1`], ['O6', `${quote(member.sheet)}!P1-(${quote(member.sheet)}!D1-${quote(member.sheet)}!H1)`]]) this.appendFormula('Analyze', address, addition);
    }
    return group;
  }
  private appendFormula(sheet: string, address: string, addition: string) {
    const original = this.cell(sheet, address)?.formula || String(this.number(sheet, address));
    this.formula(sheet, address, `(${original})+(${addition})`);
  }
  private ensureCurrency(sheet: string, currency: string, rate?: number) {
    if (this.currencySections(sheet).some(s => s.currency === currency)) return;
    const header = this.lastContentRow(sheet) + 2, total = header + 2;
    const referenceHeader = this.currencySections('Assets').find(s => s.currency === 'USD')?.header ?? 1;
    this.copyRowFrom('Assets', referenceHeader, sheet, header, 14); this.copyRowFrom('WTH', 2, sheet, header + 1, 14, true);
    for (const [col, value] of [['A', 'Assets'], ['B', `in ${currency}`], ['C', 'Exchange Rate:'], ['G', 'Last Month Ex-Rate:'], ['I', 'Ex-Rate Float:']] as Array<[string, Scalar]>) this.set(sheet, `${col}${header}`, value);
    if (sheet === 'Assets') { if (!rate || !Number.isFinite(rate) || rate <= 0) throw new Error('请填写有效的新币种兑人民币汇率'); this.set(sheet, `D${header}`, rate); this.set(sheet, `H${header}`, rate); }
    else { this.formula(sheet, `D${header}`, `Assets!${this.rateAddress(currency)}`); this.formula(sheet, `H${header}`, `Assets!${this.rateAddress(currency, true)}`); }
    this.formula(sheet, `E${header}`, `E${total}*D${header}`); this.formula(sheet, `F${header}`, `IF(D1=0,0,E${header}/D1)`); this.formula(sheet, `J${header}`, `D${header}/H${header}-1`);
    this.copyRowFrom('WTH', this.currencySections('WTH')[0].total, sheet, total, 14);
    this.set(sheet, `A${total}`, 'Grand Total'); for (const col of ['E', 'I', 'J']) this.formula(sheet, `${col}${total}`, '0'); this.set(sheet, `H${total}`, 0); this.set(sheet, `F${total}`, 1);
    this.appendFormula(sheet, 'D1', `E${header}`);
    const gain = `J${total}*D${header}+H${total}*(D${header}-H${header})`;
    if (sheet === 'Assets' || sheet === 'WTH') this.appendFormula('Analyze', sheet === 'Assets' ? 'C7' : 'I7', `${quote(sheet)}!J${total}*${quote(sheet)}!D${header}+${quote(sheet)}!H${total}*(${quote(sheet)}!D${header}-${quote(sheet)}!H${header})`);
    else this.appendFormula(sheet, 'P1', gain);
    const xirr = this.xirrSheet(sheet), start = this.lastContentRow(xirr) + 2;
    this.copyRowFrom('XIRR-WTH', 1, xirr, start, 9, true); this.set(xirr, `B${start}`, `in ${currency}`); this.copyRowFrom('XIRR-WTH', 2, xirr, start + 1, 9, true);
    if (sheet === 'Assets') this.analyzeCurrencyColumn(currency);
  }
  private analyzeCurrencyColumn(currency: string): string {
    const standard: Record<string, string> = { RMB: 'O', USD: 'P', HKD: 'Q' };
    if (standard[currency]) return standard[currency];
    for (const a of this.sheet('Analyze').cells.keys()) if (/^[A-Z]+11$/.test(a) && column(a.replace(/\d+/, '')) >= 19 && this.value('Analyze', a) === currency) return a.replace(/\d+/, '');
    let col = 19; while (this.value('Analyze', `${letters(col)}11`)) col++;
    const target = letters(col);
    for (const row of [10, 11, ...this.analyzeCategoryRows(), 31, ...this.liquidityRows()]) {
      const source = this.sheet('Analyze').cells.get(`Q${row}`), node = this.node('Analyze', `${target}${row}`);
      if (source?.hasAttribute('s')) node.setAttribute('s', source.getAttribute('s'));
      this.set('Analyze', `${target}${row}`, 0);
    }
    this.set('Analyze', `${target}11`, currency);
    const liquidity = this.liquidityRows(); this.set('Analyze', `${target}${liquidity[0] - 1}`, currency);
    const categories = this.analyzeCategoryRows(); this.formula('Analyze', `${target}10`, `SUM(${target}${categories[0] || 12}:${target}${categories.slice(-1)[0] || 16})`);
    return target;
  }
  private analyzeCategoryRows(): number[] {
    const rows: number[] = [];
    for (let row = 12; row < 1000 && this.value('Analyze', `N${row}`); row++) rows.push(row);
    return rows;
  }
  private analyzeCategoryRow(category: string): number {
    const rows = this.analyzeCategoryRows();
    const existing = rows.find(r => normalizeProductCategory(String(this.value('Analyze', `N${r}`)).trim()) === category);
    if (existing !== undefined) return existing;
    const at = rows.slice(-1)[0] ? rows.slice(-1)[0] + 1 : 17;
    this.shiftRows('Analyze', at, 1); this.copyStyle('Analyze', at - 1, at, Math.max(17, ...this.currencyCodes().map(c => column(this.analyzeCurrencyColumn(c)))));
    for (const col of ['B', 'H', 'N']) this.set('Analyze', `${col}${at}`, category);
    for (const col of ['C', 'D', 'E', 'I', 'J', 'K']) this.set('Analyze', `${col}${at}`, 0);
    for (const [col, a, b] of [['O', 'C', 'I'], ['P', 'D', 'J'], ['Q', 'E', 'K']]) this.formula('Analyze', `${col}${at}`, `${a}${at}+${b}${at}`);
    for (const currency of this.currencyCodes()) {
      const col = this.analyzeCurrencyColumn(currency); if (column(col) > 17) this.set('Analyze', `${col}${at}`, 0);
      this.formula('Analyze', `${col}10`, `SUM(${col}12:${col}${at})`);
    }
    return at;
  }
  liquidityRows(): number[] {
    const marker = [...this.sheet('Analyze').cells.keys()].find(a => /^M\d+$/.test(a) && this.value('Analyze', a) === 'Liquidity');
    const start = marker ? +marker.slice(1) + 2 : 32;
    return Array.from({ length: 5 }, (_, i) => start + i);
  }
  liquiditySummary(): number[] {
    return this.liquidityRows().map(row => this.currencyCodes().reduce((total, currency) => total + this.number('Analyze', `${this.analyzeCurrencyColumn(currency)}${row}`) * this.exchangeRate(currency), 0));
  }
  private includeProductGroupInAnalyze(group: { sheet: string; currency: string; category: string }, productRow: number, categoryTotal: number) {
    const row = this.analyzeCategoryRow(group.category), familyCol = this.analyzeCurrencyColumn(group.currency);
    const baseIndex = ['RMB', 'USD', 'HKD'].indexOf(group.currency);
    const col = baseIndex < 0 ? familyCol : group.sheet === 'Assets' ? ['C', 'D', 'E'][baseIndex] : group.sheet === 'WTH' ? ['I', 'J', 'K'][baseIndex] : familyCol;
    this.appendFormula('Analyze', `${col}${row}`, `${quote(group.sheet)}!E${categoryTotal}`);
    const liquidity = this.liquidityRows(), sheet = quote(group.sheet), balances = `${sheet}!E${productRow}:E${productRow}`, dates = `${sheet}!G${productRow}:G${productRow}`;
    const limits = [`Assets!$L$1`, `N${liquidity[1]}`, `N${liquidity[2]}`];
    const additions = [
      `SUMIFS(${balances},${dates},\">\"&${limits[0]},${dates},\"<=\"&${limits[1]})`,
      `SUMIFS(${balances},${dates},\">\"&${limits[1]},${dates},\"<=\"&${limits[2]})`,
      `SUMIF(${dates},\">\"&${limits[2]},${balances})`,
    ];
    additions.forEach((formula, i) => this.appendFormula('Analyze', `${col}${liquidity[i + 1]}`, formula));
    if (col !== familyCol) {
      const section = this.currencySections(group.sheet).find(s => s.currency === group.currency)!;
      this.formula('Analyze', `${col}${liquidity[4]}`, `${sheet}!E${section.header === 1 ? 1 : section.total}-SUM(${col}${liquidity[0]}:${col}${liquidity[3]})`);
    } else this.appendFormula('Analyze', `${col}${liquidity[4]}`, `SUM(${balances})-(${additions.join('+')})`);
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
    this.engine.invalidate(sheet, address);
  }
  formula(s: string, a: string, f: string) { this.set(s, a, null, f); }
  products(): Product[] {
    const out: Product[] = [];
    const members = this.members();
    for (const s of this.sheets.filter(x => members.some(m => m.sheet === x.name))) {
      let currency = 'RMB', category = '', account = '';
      const rows = [...new Set([...s.cells.keys()].map(a => +a.replace(/[A-Z]+/, '')))].sort((a, b) => a - b);
      for (const row of rows) {
        const val = (c: string) => this.value(s.name, `${c}${row}`);
        if (val('A') === 'Assets') { currency = String(val('B')).replace('in ', ''); category = ''; account = ''; }
        const b = val('B'), c = val('C'), name = val('D');
        if (b && b !== 'Sub Total' && b !== 'Category') category = String(b).trim();
        if (c && c !== 'Sub Total' && c !== 'Account' && c !== 'Grand Total' && c !== 'Exchange Rate:') account = String(c);
        if (typeof name !== 'string' || !name || name === 'Product' || row < 3 || !category || /Exchange Rate/.test(String(c))) continue;
        const product: Product = { sheet: s.name, row, name, account, category: normalizeProductCategory(category), sourceCategory: category, currency, member: members.find(m => m.sheet === s.name)!.member, balance: this.number(s.name, `E${row}`), previous: this.number(s.name, `H${row}`), flow: val('I'), due: isoDate(val('G')), note: String(val('N') || '') };
        product.block = this.blockFor(product); out.push(product);
      }
    }
    return out;
  }
  liabilities(): Liability[] {
    const rows = [...new Set([...this.sheet('Liabilities').cells.keys()].filter(a => /^C\d+$/.test(a)).map(a => +a.slice(1)))].sort((a, b) => a - b);
    return rows.filter(row => {
      const account = this.value('Liabilities', `C${row}`);
      return row > 2 && typeof account === 'string' && account.trim() && !['Sub Total', 'Grand Total', 'Account', 'Exchange Rate:'].includes(account.trim());
    }).map(row => ({ sheet: 'Liabilities', row, account: String(this.value('Liabilities', `C${row}`)), balance: this.number('Liabilities', `D${row}`), previous: this.number('Liabilities', `H${row}`), repayment: this.value('Liabilities', `G${row}`) }));
  }
  updateLiability(liability: Liability, values: { balance: number; repayment: string }) {
    const current = this.liabilities().find(row => row.row === liability.row && row.account === liability.account);
    if (!current) throw new Error('负债账户位置已变化，请重新选择');
    if (!Number.isFinite(values.balance) || values.balance < 0) throw new Error('负债余额须为有效的非负金额');
    this.set('Liabilities', `D${current.row}`, values.balance);
    // Keep numeric Excel dates and existing text untouched when only the balance changes.
    if (values.repayment !== String(current.repayment ?? '')) this.set('Liabilities', `G${current.row}`, values.repayment.trim() || null);
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
    const sheet = this.xirrSheet(p.sheet);
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
  addProductGroup(group: { sheet: string; currency: string; category: string }, name: string, account: string): Product {
    if (!name.trim() || !account.trim()) throw new Error('请填写产品名称和账户');
    const headers = [...this.sheet(group.sheet).cells.keys()].filter(a => /^A\d+$/.test(a) && this.value(group.sheet, a) === 'Assets').map(a => +a.slice(1)).sort((a, b) => a - b);
    const header = headers.find(row => this.value(group.sheet, `B${row}`) === `in ${group.currency}`);
    if (header === undefined) throw new Error('模板缺少所选币种分区，请使用包含该币种的月度模板');
    const end = headers.find(row => row > header) ?? Infinity;
    const at = [...this.sheet(group.sheet).cells.keys()].filter(a => /^A\d+$/.test(a)).map(a => +a.slice(1)).find(row => row > header && row < end && this.value(group.sheet, `A${row}`) === 'Grand Total');
    if (at === undefined || !this.cell(group.sheet, `E${at}`)?.formula) throw new Error('模板缺少该币种的汇总公式，无法创建新分组');
    const products = this.products().filter(p => p.sheet === group.sheet);
    const reference = products.filter(p => p.currency === group.currency).slice(-1)[0] || products[0];
    const findStyle = (column: string) => [...this.sheet(group.sheet).cells.keys()].filter(a => new RegExp(`^${column}\\d+$`).test(a)).map(a => +a.slice(1)).find(row => row > header && row < at && this.value(group.sheet, `${column}${row}`) === 'Sub Total') ?? reference?.row ?? header + 1;
    const styles = [reference?.row ?? header + 1, findStyle('C'), findStyle('B')];
    this.shiftRows(group.sheet, at, 4);
    const subtotal = at + 1, categoryTotal = at + 2, grandTotal = at + 4;
    for (let i = 0; i < 3; i++) this.copyStyle(group.sheet, styles[i] >= at ? styles[i] + 4 : styles[i], at + i, 14);
    for (const [column, value] of [['B', group.category], ['C', account.trim()], ['D', name.trim()], ['E', 0], ['H', 0], ['I', 0], ['N', '']] as Array<[string, Scalar]>) this.set(group.sheet, `${column}${at}`, value);
    this.formula(group.sheet, `J${at}`, `E${at}-H${at}-I${at}`);
    this.set(group.sheet, `C${subtotal}`, 'Sub Total'); this.set(group.sheet, `B${categoryTotal}`, 'Sub Total');
    for (const [row, source] of [[subtotal, at], [categoryTotal, subtotal]]) {
      this.set(group.sheet, `H${row}`, 0);
      for (const col of ['E', 'I', 'J']) this.formula(group.sheet, `${col}${row}`, `SUM(${col}${source})`);
      for (const col of ['K', 'L', 'M']) this.formula(group.sheet, `${col}${row}`, `IF(COUNT(${col}${source})=COUNTA(${col}${source}),AVERAGE(${col}${source}),"Check inputs")`);
    }
    for (const row of [at, subtotal, categoryTotal]) this.formula(group.sheet, `F${row}`, `E${row}/E${grandTotal}`);
    for (const col of ['E', 'I', 'J']) {
      const original = this.cell(group.sheet, `${col}${grandTotal}`)?.formula;
      if (original) this.formula(group.sheet, `${col}${grandTotal}`, `(${original})+${col}${categoryTotal}`);
      else if (col === 'J') this.formula(group.sheet, `${col}${grandTotal}`, `${this.number(group.sheet, `${col}${grandTotal}`)}+${col}${categoryTotal}`);
    }
    const product = this.products().find(p => p.sheet === group.sheet && p.row === at)!;
    this.cashAccountFlow(product); this.createEmptyBlock(product);
    this.includeProductGroupInAnalyze(group, at, categoryTotal);
    return this.products().find(p => p.sheet === group.sheet && p.row === at)!;
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
    const xs = this.xirrSheet(p.sheet);
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
    this.formula(xs, `D${end}`, 'Assets!$L$1'); this.formula(xs, `E${end}`, `${quote(p.sheet)}!E${p.row}`); this.formula(xs, `F${end}`, `F${start}`);
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
    const combined = this.blocks(this.xirrSheet(p.sheet)).some(b => (this.cell(b.sheet, `E${b.end}`)?.formula || '').match(new RegExp(`(?:${p.sheet}|${quote(p.sheet)})!E${p.row}(?![0-9])`)));
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
    const xs = this.xirrSheet(p.sheet); let b = p.block;
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
    this.formula(xs, `D${end}`, 'Assets!$L$1'); this.formula(xs, `E${end}`, `${quote(p.sheet)}!E${p.row}`); this.formula(xs, `F${end}`, `SUM(F${start}:F${end - 1})`);
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
    for (const { sheet: s } of this.members()) {
      values.push([s, 'H1', this.value(s, 'D1')]);
      for (const a of this.sheet(s).cells.keys()) if (/^H\d+$/.test(a) && a !== 'H1' && !this.cell(s, a)?.formula && typeof this.cell(s, a)?.value === 'number') values.push([s, a, this.value(s, a.replace('H', 'E'))]);
    }
    const liabilities = this.value('Liabilities', 'D1');
    for (const a of this.sheet('Liabilities').cells.keys()) if (/^H\d+$/.test(a) && !this.cell('Liabilities', a)?.formula && typeof this.cell('Liabilities', a)?.value === 'number') values.push(['Liabilities', a, this.value('Liabilities', a.replace('H', 'D'))]);
    for (const [s, a, v] of values) this.set(s, a, v);
    for (const { sheet: s } of this.members()) for (const a of this.sheet(s).cells.keys()) if (/^I\d+$/.test(a) && !this.cell(s, a)?.formula && typeof this.cell(s, a)?.value === 'number') this.set(s, a, 0);
    for (const currency of this.currencyCodes().filter(c => c !== 'RMB')) this.set('Assets', this.rateAddress(currency, true), this.value('Assets', this.rateAddress(currency)));
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
      let dimension = descendants(doc, 'dimension')[0];
      if (!dimension) { dimension = this.element(doc, 'dimension'); const views = descendants(doc, 'sheetViews')[0] || descendants(doc, 'sheetFormatPr')[0] || descendants(doc, 'cols')[0] || descendants(doc, 'sheetData')[0]; doc.documentElement.insertBefore(dimension, views); }
      const addresses = [...s.cells.keys()];
      const lastRow = Math.max(1, ...addresses.map(a => +a.replace(/[A-Z]+/, ''))), lastColumn = Math.max(1, ...addresses.map(a => column(a.replace(/\d+/, ''))));
      dimension.setAttribute('ref', `A1:${letters(lastColumn)}${lastRow}`);
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
