import Decimal from 'decimal.js';

export type Scalar = number | string | boolean | null;
export type Value = Scalar | Value[];
export interface FormulaCell { value: Scalar; formula?: string; }
export type Lookup = (sheet: string, address: string) => FormulaCell | undefined;
const flatten = (v: Value): Scalar[] => Array.isArray(v) ? ([] as Scalar[]).concat(...v.map(flatten)) : [v];
const numeric = (v: Value): number => {
  if (Array.isArray(v)) return numeric(v[0]);
  if (typeof v === 'string' && v !== '' && !Number.isFinite(Number(v))) throw new Error(v.startsWith('#') ? v : '#VALUE!');
  return Number(v || 0);
};
function broadcast(a: Value, b: Value, op: (x: Scalar, y: Scalar) => Scalar): Value {
  if (Array.isArray(a)) return a.map((x, i) => broadcast(x, Array.isArray(b) ? b[i] : b, op));
  if (Array.isArray(b)) return b.map((y) => broadcast(a, y, op));
  return op(a, b);
}
export const column = (s: string) => s.replace(/\$/g, '').split('').reduce((n, c) => n * 26 + c.charCodeAt(0) - 64, 0);
export function letters(n: number): string { let s = ''; while (n > 0) { n--; s = String.fromCharCode(65 + n % 26) + s; n = Math.floor(n / 26); } return s; }
export const serialDate = (date: string): number => { const n = Date.parse(`${date}T00:00:00Z`); if (!Number.isFinite(n) || new Date(n).toISOString().slice(0, 10) !== date) throw new Error('日期无效'); return n / 86400000 + 25569; };
export const isoDate = (v: Value): string => typeof v === 'number' && v > 0 ? new Date((v - 25569) * 86400000).toISOString().slice(0, 10) : '';

// Solve in log(1+r) space so negative returns stay above -100%.
export function xirr(amounts: number[], dates: number[], guess = 0.1): number {
  if (amounts.length !== dates.length || amounts.length < 2 || !amounts.some(x => x < 0) || !amounts.some(x => x > 0) || dates.some(x => !Number.isFinite(x) || x <= 0) || dates.some(x => x < dates[0]) || Math.max(...dates) === Math.min(...dates)) throw new Error('#NUM!');
  const t = dates.map(d => (d - dates[0]) / 365);
  const scale = Math.max(...amounts.map(Math.abs));
  const f = (y: number) => amounts.reduce((s, a, i) => s + a / scale * Math.exp(-y * t[i]), 0);
  let y = Math.log1p(guess > -1 ? guess : 0.1);
  for (let i = 0; i < 80; i++) {
    const v = f(y), derivative = amounts.reduce((s, a, j) => s - t[j] * a / scale * Math.exp(-y * t[j]), 0);
    if (Math.abs(v) < 1e-11) return Math.expm1(y);
    const next = y - v / derivative;
    if (!Number.isFinite(next) || next < -20 || next > 30) break;
    y = next;
  }
  let left = -20, fl = f(left);
  for (let right = -19.75; right <= 30; right += 0.25) {
    const fr = f(right);
    if (Number.isFinite(fl) && Number.isFinite(fr) && fl * fr <= 0) {
      let lo = left, hi = right;
      for (let i = 0; i < 180; i++) { const mid = (lo + hi) / 2, fm = f(mid); if (Math.abs(fm) < 1e-12) return Math.expm1(mid); if (fl * fm <= 0) hi = mid; else { lo = mid; fl = fm; } }
      return Math.expm1((lo + hi) / 2);
    }
    left = right; fl = fr;
  }
  throw new Error('#NUM!');
}

type Node = { kind: string; text: string; args?: Node[] };
const reference = /^(?:(?:'((?:[^']|'')+)'|([A-Za-z_][\w.]*))!)?(\$?[A-Z]{1,3}\$?\d+)(?::(\$?[A-Z]{1,3}\$?\d+))?$/;
const tokenPattern = /\s*("(?:[^"]|"")*"|(?:'(?:[^']|'')+'|[A-Za-z_][\w.]*)!\$?[A-Z]{1,3}\$?\d+(?::\$?[A-Z]{1,3}\$?\d+)?|\$?[A-Z]{1,3}\$?\d+(?::\$?[A-Z]{1,3}\$?\d+)?(?![\w.(])|(?:\d+(?:\.\d*)?|\.\d+)(?:[eE][+-]?\d+)?|[A-Za-z_][\w.]*|<>|<=|>=|[+\-*/^&=<>(),%])/gy;
function parse(formula: string): Node {
  const input = formula.replace(/^=/, ''); const tokens: string[] = []; let pos = 0;
  while (pos < input.length) { tokenPattern.lastIndex = pos; const m = tokenPattern.exec(input); if (!m) { if (!input.slice(pos).trim()) break; throw new Error('#UNSUPPORTED!'); } tokens.push(m[1]); pos = tokenPattern.lastIndex; }
  let i = 0;
  const precedence: Record<string, number> = { '=': 1, '<>': 1, '<': 1, '>': 1, '<=': 1, '>=': 1, '&': 2, '+': 3, '-': 3, '*': 4, '/': 4, '^': 5 };
  const expression = (min = 0): Node => {
    const t = tokens[i++]; let n: Node;
    if (t === '+' || t === '-') n = { kind: 'unary', text: t, args: [expression(5)] };
    else if (t === '(') { n = expression(); if (tokens[i++] !== ')') throw new Error('#PARSE!'); }
    else if (!t) throw new Error('#PARSE!');
    else if (tokens[i] === '(') { i++; const args: Node[] = []; if (tokens[i] !== ')') { do { args.push(expression()); } while (tokens[i] === ',' && ++i); } if (tokens[i++] !== ')') throw new Error('#PARSE!'); n = { kind: 'call', text: t.replace(/^_xlfn\./, '').toUpperCase(), args }; }
    else n = { kind: 'literal', text: t };
    while (tokens[i] === '%') { i++; n = { kind: 'binary', text: '/', args: [n, { kind: 'literal', text: '100' }] }; }
    while (precedence[tokens[i]] !== undefined && precedence[tokens[i]] >= min) { const op = tokens[i++], p = precedence[op]; n = { kind: 'binary', text: op, args: [n, expression(p + (op === '^' ? 0 : 1))] }; }
    return n;
  };
  const n = expression(); if (i !== tokens.length) throw new Error('#PARSE!'); return n;
}

export class FormulaEngine {
  private memo = new Map<string, Value>();
  private visiting = new Set<string>();
  private parsed = new Map<string, Node>();
  private dependencies = new Map<string, Set<string>>();
  private dependents = new Map<string, Set<string>>();
  private stack: string[] = [];
  constructor(private lookup: Lookup) {}
  clear() { this.memo.clear(); this.visiting.clear(); this.dependencies.clear(); this.dependents.clear(); this.stack = []; }
  fork(lookup: Lookup): FormulaEngine {
    const next = new FormulaEngine(lookup);
    next.memo = new Map(this.memo); next.parsed = this.parsed;
    next.dependencies = new Map([...this.dependencies].map(([key, values]) => [key, new Set(values)]));
    next.dependents = new Map([...this.dependents].map(([key, values]) => [key, new Set(values)]));
    return next;
  }
  private unlink(key: string) {
    for (const dependency of this.dependencies.get(key) || []) {
      const parents = this.dependents.get(dependency); parents?.delete(key);
      if (!parents?.size) this.dependents.delete(dependency);
    }
    this.dependencies.delete(key);
  }
  invalidate(sheet: string, address: string) {
    const key = `${sheet}!${address.replace(/\$/g, '')}`, pending = [key], affected = new Set<string>();
    while (pending.length) {
      const current = pending.pop()!; if (affected.has(current)) continue;
      affected.add(current); this.memo.delete(current);
      for (const parent of this.dependents.get(current) || []) pending.push(parent);
    }
    this.unlink(key);
  }
  get(sheet: string, address: string): Scalar {
    address = address.replace(/\$/g, ''); const key = `${sheet}!${address}`;
    const parent = this.stack[this.stack.length - 1];
    if (parent && parent !== key) {
      if (!this.dependencies.has(parent)) this.dependencies.set(parent, new Set());
      if (!this.dependents.has(key)) this.dependents.set(key, new Set());
      this.dependencies.get(parent)!.add(key); this.dependents.get(key)!.add(parent);
    }
    if (this.memo.has(key)) return this.memo.get(key) as Scalar;
    const cell = this.lookup(sheet, address); if (!cell) return null;
    if (!cell.formula) return cell.value;
    if (this.visiting.has(key)) return '#CYCLE!';
    this.unlink(key); this.visiting.add(key); this.stack.push(key); let value: Value;
    try { let n = this.parsed.get(cell.formula); if (!n) { n = parse(cell.formula); this.parsed.set(cell.formula, n); } value = this.evaluate(n, sheet); if (Array.isArray(value)) value = flatten(value)[0]; if (typeof value === 'number' && !Number.isFinite(value)) value = '#NUM!'; }
    catch (error) { value = error.message || '#VALUE!'; }
    this.stack.pop(); this.visiting.delete(key); this.memo.set(key, value); return value as Scalar;
  }
  private evaluate(n: Node, sheet: string): Value {
    const args = n.args || [];
    const ev = (node: Node) => this.evaluate(node, sheet);
    if (n.kind === 'literal') {
      if (n.text.startsWith('"')) return n.text.slice(1, -1).replace(/""/g, '"');
      if (/^(TRUE|FALSE)$/i.test(n.text)) return n.text.toUpperCase() === 'TRUE';
      const m = n.text.match(reference);
      if (!m) { if (Number.isFinite(Number(n.text))) return Number(n.text); throw new Error('#NAME?'); }
      const target = (m[1] || m[2] || sheet).replace(/''/g, "'");
      if (!m[4]) return this.get(target, m[3]);
      const a = m[3].match(/([A-Z]+)\$?(\d+)/)!, b = m[4].match(/([A-Z]+)\$?(\d+)/)!;
      if ((+b[2] - +a[2] + 1) * (column(b[1]) - column(a[1]) + 1) > 50000) throw new Error('#RANGE!');
      const out: Value[] = [];
      for (let r = +a[2]; r <= +b[2]; r++) for (let c = column(a[1]); c <= column(b[1]); c++) out.push(this.get(target, `${letters(c)}${r}`));
      return out;
    }
    if (n.kind === 'unary') return broadcast(ev(args[0]), 0, x => n.text === '-' ? -numeric(x) : numeric(x));
    if (n.kind === 'binary') return broadcast(ev(args[0]), ev(args[1]), (a, b) => {
      if (n.text === '&') return `${a === null ? '' : a}${b === null ? '' : b}`;
      if (['=', '<>', '<', '>', '<=', '>='].includes(n.text)) { const x: any = a === null ? 0 : a, y: any = b === null ? 0 : b; switch (n.text) { case '=': return x === y; case '<>': return x !== y; case '<': return x < y; case '>': return x > y; case '<=': return x <= y; default: return x >= y; } }
      const x = numeric(a), y = numeric(b); const d = new Decimal(x);
      switch (n.text) { case '+': return d.plus(y).toNumber(); case '-': return d.minus(y).toNumber(); case '*': return d.times(y).toNumber(); case '/': if (y === 0) throw new Error('#DIV/0!'); return d.div(y).toNumber(); default: return Math.pow(x, y); }
    });
    if (n.text === 'IF') { const condition = ev(args[0]); if (typeof condition === 'string' && condition.startsWith('#')) throw new Error(condition); return ev(args[Boolean(condition) ? 1 : 2]); }
    const values = args.map(ev), flat = flatten(values), nums = flat.filter((x): x is number => typeof x === 'number');
    const fail = flat.find(x => typeof x === 'string' && x.startsWith('#'));
    if (fail && !['COUNT', 'COUNTA', 'ISNUMBER'].includes(n.text)) throw new Error(String(fail));
    switch (n.text) {
      case 'SUM': return nums.reduce((s, x) => s.plus(x), new Decimal(0)).toNumber();
      case 'PRODUCT': return nums.reduce((s, x) => s.times(x), new Decimal(1)).toNumber();
      case 'COUNT': return nums.length;
      case 'COUNTA': return flat.filter(x => x !== null && x !== '').length;
      case 'AVERAGE': if (!nums.length) throw new Error('#DIV/0!'); return nums.reduce((s, x) => s.plus(x), new Decimal(0)).div(nums.length).toNumber();
      case 'POWER': return Math.pow(numeric(values[0]), numeric(values[1]));
      case 'VSTACK': return flat;
      case 'OR': return flat.some(Boolean);
      case 'NOT': return !values[0];
      case 'ISNUMBER': return typeof values[0] === 'number';
      case 'XIRR': return xirr(flatten(values[0]).map(numeric), flatten(values[1]).map(numeric), values.length > 2 ? numeric(values[2]) : 0.1);
      case 'EOMONTH': { const d = new Date((numeric(values[0]) - 25569) * 86400000); return Date.UTC(d.getUTCFullYear(), d.getUTCMonth() + numeric(values[1]) + 1, 0) / 86400000 + 25569; }
      case 'TEXT': return isoDate(values[0]);
      case 'SUMIF': case 'SUMIFS': {
        const sum = flatten(values[n.text === 'SUMIF' ? 2 : 0]);
        const pairs = n.text === 'SUMIF' ? [[values[0], values[1]]] : values.slice(1).reduce<Value[][]>((p, v, i) => { if (i % 2 === 0) p.push([v]); else p[p.length - 1].push(v); return p; }, []);
        return sum.reduce<Decimal>((s, val, i) => {
          const match = pairs.every(([range, criterion]) => { const item = flatten(range)[i], m = String(criterion).match(/^(<=|>=|<>|<|>|=)?(.*)$/)!; const raw = m[2], cmp: any = raw !== '' && Number.isFinite(Number(raw)) ? Number(raw) : raw; const x: any = item === null ? 0 : item; switch (m[1] || '=') { case '>': return x > cmp; case '<': return x < cmp; case '>=': return x >= cmp; case '<=': return x <= cmp; case '<>': return x !== cmp; default: return x === cmp; } });
          return match && typeof val === 'number' ? s.plus(val) : s;
        }, new Decimal(0)).toNumber();
      }
      default: throw new Error('#UNSUPPORTED!');
    }
  }
}
