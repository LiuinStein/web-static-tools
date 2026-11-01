const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const ts = require('typescript');
const ExcelJS = require('exceljs');
const JSZip = require('jszip');
require.extensions['.ts'] = (m, f) => m._compile(ts.transpileModule(fs.readFileSync(f, 'utf8'), { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2020, esModuleInterop: true } }).outputText, f);
const { FormulaEngine, serialDate, xirr } = require('../src/pages/MonthlyReview/formula.ts');
const { MonthlyWorkbook, rewriteReferences } = require('../src/pages/MonthlyReview/workbook.ts');
const { MonthlyDrive, normalizeFolder } = require('../src/pages/MonthlyReview/onedrive.ts');
const { productGroups, createProductEntry } = require('../src/pages/MonthlyReview/product-entry.ts');
const { cashFlowSummary } = require('../src/pages/MonthlyReview/transactions.ts');
async function fixture() {
  const wb = new ExcelJS.Workbook();
  for (const name of ['Assets', 'XIRR', 'Liabilities', 'Analyze', 'WTH', 'XIRR-WTH']) wb.addWorksheet(name);
  for (const name of ['Assets', 'WTH']) {
    const s = wb.getWorksheet(name);
    const values = { A1: 'Assets', B1: 'in RMB', D2: 'Product', E2: 'Current Balance', B3: 'Debt Fund', C3: '示例账户', D3: `${name} 示例产品`, E3: 1100, H3: 1000, I3: 0, C4: 'Sub Total' };
    for (const [a, v] of Object.entries(values)) s.getCell(a).value = v;
    for (const [a, f] of Object.entries({ D1: 'E4', E1: 'E4', E4: 'SUM(E3:E3)', J3: 'E3-H3-I3', J4: 'SUM(J3:J3)', F3: 'E3/$E$1' })) s.getCell(a).value = { formula: f };
    s.getCell('H1').value = 1000; s.getCell('L1').value = serialDate('2026-10-31'); s.getCell('N1').value = serialDate('2026-09-30');
  }
  const a = wb.getWorksheet('Analyze'); a.getCell('O3').value = { formula: 'Assets!D1+WTH!D1' }; a.getCell('Q3').value = { formula: 'O3-Liabilities!D1' };
  wb.getWorksheet('Liabilities').getCell('D1').value = 10;
  for (const [row, currency, rate] of [[61, 'USD', 7], [81, 'HKD', 0.9]]) { const assets = wb.getWorksheet('Assets'); assets.getCell(`A${row}`).value = 'Assets'; assets.getCell(`B${row}`).value = `in ${currency}`; assets.getCell(`D${row}`).value = rate; }
  const zip = await JSZip.loadAsync(await wb.xlsx.writeBuffer()); zip.file('custom/untouched.xml', '<keep>original</keep>');
  return MonthlyWorkbook.open(await zip.generateAsync({ type: 'uint8array' }));
}
test('formula evaluator handles subtraction before cross-sheet references, arrays, lazy IF and decimal sums', () => {
  const cells = { 'S!A1': { value: 0, formula: '1-(Assets!B2-2)' }, 'Assets!B2': { value: 2.5 }, 'S!A2': { value: 0, formula: 'SUM(0.1,0.2)' }, 'S!A3': { value: 0, formula: 'IF(1=1,7,1/0)' }, 'S!A4': { value: 0, formula: 'PRODUCT(A5:A6+1)' }, 'S!A5': { value: 0.1 }, 'S!A6': { value: 0.2 } };
  const e = new FormulaEngine((s, a) => cells[`${s}!${a}`]);
  assert.equal(e.get('S', 'A1'), 0.5); assert.equal(e.get('S', 'A2'), 0.3); assert.equal(e.get('S', 'A3'), 7); assert.equal(e.get('S', 'A4'), 1.32);
});
test('XIRR supports positive and negative returns and rejects invalid cash flows', () => {
  assert.ok(Math.abs(xirr([-1000, 1100], [45000, 45365]) - 0.1) < 1e-9);
  assert.ok(Math.abs(xirr([-1000, 500], [45000, 45365]) + 0.5) < 1e-9);
  assert.throws(() => xirr([100, 200], [45000, 45365])); assert.throws(() => serialDate('2026-02-30'));
});
test('row-reference edits preserve quoted labels, adjust absolute and cross-sheet references, contract ranges', () => {
  assert.equal(rewriteReferences('SUM($E$3:E5)+Assets!E7+"Assets!E7"', 'Assets', 'Assets', 5, 1), 'SUM($E$3:E6)+Assets!E8+"Assets!E7"');
  assert.equal(rewriteReferences("'XIRR-WTH'!E8+Assets!E4", 'Assets', 'XIRR-WTH', 3, 2, true), "'XIRR-WTH'!E6+Assets!E4");
  assert.equal(rewriteReferences('SUM(E3:E5)', 'Assets', 'Assets', 5, 1, true), 'SUM(E3:E4)');
  assert.equal(rewriteReferences('AVERAGE(E3,E5)', 'Assets', 'Assets', 3, 1, true), 'AVERAGE(E4)');
});
test('new products, buys, partial sales, dividends and closed positions survive Excel roundtrip', async () => {
  let b = await fixture(); const originalTotal = b.number('Assets', 'D1');
  let p = b.addProduct(b.products()[0], '新理财', '新账户');
  assert.ok(p.block); assert.equal(b.transactions(p.block).length, 0);
  b.updateProduct(p, { name: p.name, account: p.account, balance: 1080, previous: 0, flow: 1000, due: '', note: '测试' });
  const buy = { kind: 'buy', date: '2026-10-01', amount: 1000, shares: 100, price: 10 };
  b.saveTransactions(p, [buy]); p = b.products().find(x => x.name === '新理财');
  assert.ok(b.number(p.sheet, `K${p.row}`) > 0); assert.equal(b.number('Assets', 'D1'), originalTotal + 1080);
  const partial = { kind: 'sell', date: '2026-10-15', amount: 550, shares: 50, price: 11 };
  b.saveTransactions(p, [buy, partial]); p = b.products().find(x => x.name === '新理财');
  assert.equal(b.transactions(p.block).length, 2); assert.equal(b.number(p.block.sheet, `F${p.block.end}`), 50);
  const div = { kind: 'dividend', date: '2026-10-20', amount: 10, shares: 0, price: 11 };
  b.saveTransactions(p, [buy, partial, div]); p = b.products().find(x => x.name === '新理财');
  assert.equal(b.number(p.sheet, `I${p.row}`), 440);
  b.saveTransactions(p, [buy, { ...partial, shares: 100, amount: 1100 }]); p = b.products().find(x => x.name === '新理财');
  assert.equal(p.balance, 0); assert.ok(b.number(p.sheet, `K${p.row}`) > 0);
  const data = await b.export(); const zip = await JSZip.loadAsync(data); assert.equal(await zip.file('custom/untouched.xml').async('string'), '<keep>original</keep>');
  b = await MonthlyWorkbook.open(data); p = b.products().find(x => x.name === '新理财'); assert.equal(b.transactions(p.block).length, 2);
  b.deleteProduct(p); assert.equal(b.products().some(x => x.name === '新理财'), false); assert.equal(b.number('Assets', 'D1'), originalTotal);
  assert.equal(b.blocks('XIRR').some(x => b.value('XIRR', `C${x.start}`) === '新理财'), false);
});
test('transactions reject oversells, missing dates and future dates before mutation', async () => {
  const b = await fixture(); const p = b.products()[0]; const original = b.number('Analyze', 'O3');
  assert.throws(() => b.saveTransactions(p, [{ kind: 'sell', date: '2026-10-01', amount: 100, shares: 10, price: 10 }]), /超过/);
  assert.throws(() => b.saveTransactions(p, [{ kind: 'buy', date: '', amount: 100, shares: 10, price: 10 }]), /日期/);
  assert.throws(() => b.saveTransactions(p, [{ kind: 'buy', date: '2026-11-01', amount: 100, shares: 10, price: 10 }]), /日期/);
  assert.equal(b.number('Analyze', 'O3'), original);
});
test('new months preserve historical transactions and independently snapshot opening values', async () => {
  const b = await fixture(); b.rollover('2026-11-30'); assert.equal(b.value('Assets', 'H3'), 1100); assert.equal(b.value('Assets', 'N1'), serialDate('2026-10-31')); assert.equal(b.value('Assets', 'H1'), 1100); assert.throws(() => b.rollover('2026-10-01'));
});
test('new products use member/currency/category groups, start without an opening balance and accept new accounts', async () => {
  let b = await fixture(); const groups = productGroups(); assert.equal(groups.length, 16);
  assert.ok(groups.every(g => !('name' in g) && !('account' in g)));
  const group = groups.find(g => g.sheet === 'Assets' && g.currency === 'RMB' && g.category === 'Debt Fund');
  const p = createProductEntry(b, group.key, { name: '  新产品  ', account: '  新账户  ', balance: 1100, flow: 1000, previous: 999, due: '', note: '' }, 'manual');
  assert.equal(p.name, '新产品'); assert.equal(p.account, '新账户'); assert.equal(p.previous, 0); assert.equal(p.flow, 1000); assert.equal(p.category, group.category);
  assert.equal(b.number(p.sheet, `J${p.row}`), 100); assert.equal(b.transactions(p.block).length, 0);
  assert.equal(productGroups().length, 16);
  b = await MonthlyWorkbook.open(await b.export()); assert.ok(b.products().some(x => x.account === '新账户' && x.previous === 0 && x.flow === 1000));
});
test('a new product can record multiple purchases, sales and distributions across a multi-month accounting period', async () => {
  let b = await fixture(); b.set('Assets', 'N1', serialDate('2026-07-05')); b.set('Assets', 'L1', serialDate('2026-10-11'));
  const group = productGroups().find(g => g.sheet === 'Assets' && g.currency === 'RMB' && g.category === 'Debt Fund');
  const rows = [
    { kind: 'buy', date: '2026-07-06', amount: 1000, shares: 100, price: 10 },
    { kind: 'buy', date: '2026-08-01', amount: 500, shares: 50, price: 10 },
    { kind: 'sell', date: '2026-09-01', amount: 220, shares: 20, price: 11 },
    { kind: 'dividend', date: '2026-10-01', amount: 10, shares: 0, price: 11 },
  ];
  let p = createProductEntry(b, group.key, { name: '多笔交易产品', account: '新账户', balance: 1400, flow: 999999, due: '', note: '' }, 'transactions', rows);
  assert.equal(p.previous, 0); assert.equal(p.flow, 1270); assert.equal(b.number(p.sheet, `J${p.row}`), 130);
  assert.equal(b.transactions(p.block).length, 4); assert.equal(b.number(p.block.sheet, `F${p.block.end}`), 130); assert.equal(typeof b.value(p.sheet, `K${p.row}`), 'number');
  b = await MonthlyWorkbook.open(await b.export()); p = b.products().find(x => x.name === '多笔交易产品');
  assert.equal(p.flow, 1270); assert.equal(p.previous, 0); assert.equal(b.transactions(p.block).length, 4);
  assert.deepEqual(cashFlowSummary(rows, serialDate('2026-07-05'), serialDate('2026-10-11')), { buys: 1500, sales: 220, dividends: 10, net: 1270 });
});
test('new-product initial trades are validated before insertion and net cash flow uses decimal arithmetic', async () => {
  const b = await fixture(), group = productGroups().find(g => g.sheet === 'Assets' && g.currency === 'RMB' && g.category === 'Debt Fund'), before = b.products().length;
  const values = { name: '校验产品', account: '新账户', balance: 0, flow: 0, due: '', note: '' };
  assert.throws(() => createProductEntry(b, group.key, values, 'transactions', [{ kind: 'buy', date: '2026-09-30', amount: 10, shares: 1, price: 10 }]), /上次记账日期之后/);
  assert.throws(() => createProductEntry(b, group.key, values, 'transactions', [{ kind: 'sell', date: '2026-10-01', amount: 10, shares: 1, price: 10 }]), /超过持仓/);
  assert.equal(b.products().length, before);
  const rows = [{ kind: 'buy', date: '2026-10-01', amount: 0.1, shares: 1, price: 0.1 }, { kind: 'buy', date: '2026-10-02', amount: 0.2, shares: 1, price: 0.2 }];
  assert.equal(cashFlowSummary(rows, serialDate('2026-09-30'), serialDate('2026-10-31')).net, 0.3);
  const p = createProductEntry(b, group.key, values, 'transactions', [{ kind: 'buy', date: '2026-10-01', amount: 1000, shares: 100, price: 10 }, { kind: 'sell', date: '2026-10-15', amount: 1100, shares: 100, price: 11 }]);
  assert.equal(p.balance, 0); assert.equal(p.flow, -100); assert.equal(b.number(p.sheet, `J${p.row}`), 100);
});
test('new product rows keep FX lookup, settings writes and next-period FX snapshots on their currency headers', async () => {
  const b = await fixture(), group = productGroups().find(g => g.sheet === 'Assets' && g.currency === 'RMB' && g.category === 'Debt Fund');
  createProductEntry(b, group.key, { name: '插行产品', account: '新账户', balance: 10, flow: 10, due: '', note: '' }, 'manual');
  assert.equal(b.exchangeRate('USD'), 7); assert.equal(b.exchangeRate('HKD'), 0.9); assert.equal(b.rateAddress('USD'), 'D62');
  b.set('Assets', b.rateAddress('USD'), 7.1); b.rollover('2026-11-30');
  assert.equal(b.value('Assets', b.rateAddress('USD', true)), 7.1); assert.equal(b.value('Assets', b.rateAddress('HKD', true)), 0.9);
});
test('OneDrive rejects conflicts, creates without replacement and propagates failures', async () => {
  assert.equal(normalizeFolder('/月度复盘/'), '月度复盘'); assert.throws(() => normalizeFolder('../private'));
  const service = Object.create(MonthlyDrive.prototype); service.folder = '月度复盘';
  service.client = { api: () => { const q = { select: () => q, get: async () => ({ eTag: 'new' }), put: async () => { throw new Error('must not upload'); } }; return q; } };
  await assert.rejects(service.publish('2026-10.xlsx', new Uint8Array(), { id: 'id', eTag: 'old' }), /云端文件已修改/);
  const headers = []; service.ensureFolder = async () => {};
  service.client = { api: () => { const q = { query(v) { assert.equal(v['@microsoft.graph.conflictBehavior'], 'fail'); return q; }, header(k, v) { headers.push([k, v]); return q; }, async put() { throw new Error('upload denied'); } }; return q; } };
  await assert.rejects(service.publish('2026-10.xlsx', new Uint8Array()), /upload denied/); assert.ok(headers.some(([k, v]) => k === 'If-None-Match' && v === '*'));
});
const template = process.env.MONTHLY_TEMPLATE;
test('reference formula evaluator still matches Excel caches with original reference cash inputs', { skip: !template }, async () => {
  const b = await MonthlyWorkbook.open(fs.readFileSync(template)); let checked = 0;
  // Reset only the newly derived inputs for this legacy-cache regression. New cash rules are tested separately below.
  const original = await JSZip.loadAsync(fs.readFileSync(template));
  const parse = text => new (require('@xmldom/xmldom').DOMParser)().parseFromString(text, 'application/xml');
  const nodes = (doc, name) => Array.from(doc.getElementsByTagNameNS('*', name));
  const sharedPart = original.file('xl/sharedStrings.xml');
  const shared = sharedPart ? nodes(parse(await sharedPart.async('string')), 'si').map(si => nodes(si, 't').map(t => t.textContent).join('')) : [];
  const documents = new Map();
  for (const sheet of b.sheets) documents.set(sheet.name, parse(await original.file(sheet.path).async('string')));
  for (const p of b.products().filter(p => p.category === 'Current Account')) {
    const address = `I${p.row}`, cell = nodes(documents.get(p.sheet), 'c').find(c => c.getAttribute('r') === address);
    const text = cell && nodes(cell, 'v')[0]?.textContent, type = cell?.getAttribute('t');
    const value = type === 's' ? shared[Number(text)] : type === 'inlineStr' ? nodes(cell, 't').map(t => t.textContent).join('') : type === 'str' || type === 'e' ? text : text == null ? null : Number(text);
    assert.equal(b.value(p.sheet, address), new (require('decimal.js'))(p.balance).minus(p.previous).toNumber());
    b.set(p.sheet, address, value, cell && nodes(cell, 'f')[0]?.textContent || undefined);
  }
  for (const s of b.sheets) for (const a of s.cells.keys()) { const c = b.cell(s.name, a); if (!c.formula) continue; const value = b.value(s.name, a); if (typeof c.value === 'number') { assert.equal(typeof value, 'number', `${s.name}!${a}`); assert.ok(Math.abs(value - c.value) < Math.max(1e-7, Math.abs(c.value) * 1e-7), `${s.name}!${a}`); } else assert.equal(value, c.value, `${s.name}!${a}`); checked++; }
  assert.ok(checked > 1000);
});
test('reference combined-account positions can be split, traded and deleted without damaging the other account', { skip: !template }, async () => {
  const b = await MonthlyWorkbook.open(fs.readFileSync(template)); let p = b.products().find(x => x.sheet === 'Assets' && x.row === 107); assert.ok(p.block.shared);
  const other = b.products().find(x => x.sheet === 'Assets' && x.row === 108); const otherTrades = b.transactions(other.block); const trades = b.transactions(p.block);
  b.saveTransactions(p, [...trades, { kind: 'buy', date: '2026-10-11', amount: 100, shares: 2, price: 50 }]);
  p = b.products().find(x => x.sheet === 'Assets' && x.row === 107); assert.equal(b.transactions(p.block).length, 2);
  const after = b.products().find(x => x.sheet === 'Assets' && x.row === 108); assert.equal(after.block.shared, undefined); assert.deepEqual(b.transactions(after.block).map(x => ({ ...x, row: undefined })), otherTrades.map(x => ({ ...x, row: undefined })));
  b.deleteProduct(p); const data = await b.export(); const loaded = await MonthlyWorkbook.open(data); assert.ok(loaded.products().find(x => x.account === other.account && x.name === other.name));
});
test('reference new products enter the correct currency section and deletion restores original totals', { skip: !template }, async () => {
  for (const [sheet, currency] of [['Assets', 'RMB'], ['Assets', 'USD'], ['Assets', 'HKD'], ['WTH', 'RMB']]) {
    let b = await MonthlyWorkbook.open(fs.readFileSync(template)); const total = b.number(sheet, 'D1');
    const anchor = b.products().find(p => p.sheet === sheet && p.currency === currency && p.block && !p.block.shared);
    const rate = currency === 'USD' ? b.number('Assets', 'D61') : currency === 'HKD' ? b.number('Assets', 'D81') : 1;
    let p = b.addProduct(anchor, '新增验证产品', '验证账户');
    b.updateProduct(p, { name: p.name, account: p.account, balance: 1100, previous: 0, flow: 1000, due: '', note: '' });
    b.saveTransactions(p, [{ kind: 'buy', date: '2026-10-01', amount: 1000, shares: 100, price: 10 }]);
    assert.ok(Math.abs(b.number(sheet, 'D1') - total - 1100 * rate) < 1e-7, `${sheet} ${currency} total`);
    p = b.products().find(x => x.name === '新增验证产品');
    let sectionCurrency = 'RMB';
    for (let r = 1; r <= p.block.start; r++) if (b.value(p.block.sheet, `A${r}`) === 'Assets') sectionCurrency = String(b.value(p.block.sheet, `B${r}`)).replace('in ', '');
    assert.equal(sectionCurrency, currency);
    b = await MonthlyWorkbook.open(await b.export()); p = b.products().find(x => x.name === '新增验证产品'); b.deleteProduct(p);
    b = await MonthlyWorkbook.open(await b.export()); assert.ok(Math.abs(b.number(sheet, 'D1') - total) < 1e-7); assert.equal(b.products().length, 63);
  }
});

const { MonthlyBatch, productKey, balanceNumber, balancePaste } = require('../src/pages/MonthlyReview/batch.ts');
test('batch balances recalculate on an isolated workbook and export without changing opening balances, flows or saved source', async () => {
  const source = await fixture(), p = source.products()[0], key = productKey(p);
  const original = { balance: p.balance, previous: p.previous, flow: p.flow, total: source.number('Analyze', 'O3') };
  const session = new MonthlyBatch(source).balances([[key, '1,250.50']]);
  assert.equal(session.book.number(p.sheet, `E${p.row}`), 1250.5);
  assert.equal(session.book.number(p.sheet, `J${p.row}`), 250.5);
  assert.equal(session.book.number(p.sheet, `H${p.row}`), original.previous);
  assert.equal(session.book.value(p.sheet, `I${p.row}`), original.flow);
  assert.equal(source.number(p.sheet, `E${p.row}`), original.balance);
  assert.equal(source.number('Analyze', 'O3'), original.total);
  assert.ok(session.changedKeys().has(key)); assert.equal(session.reviewed.size, 0);
  const checked = session.check([key], true); assert.equal(checked.reviewed.size, 1); assert.equal(session.reviewed.size, 0);
  const invalid = checked.balances([[key, '']]); assert.deepEqual(invalid.invalid, [key]); assert.equal(invalid.reviewed.size, 0);
  assert.throws(() => invalid.apply(() => {}), /无效余额/);
  const repaired = invalid.balances([[key, '0']]); assert.equal(repaired.invalid.length, 0); assert.equal(repaired.book.number(p.sheet, `E${p.row}`), 0);
  const exported = await MonthlyWorkbook.open(await session.book.export()); assert.equal(exported.number(p.sheet, `E${p.row}`), 1250.5);
  assert.equal(exported.cell(p.sheet, `J${p.row}`).formula, 'E3-H3-I3');
  const zip = await JSZip.loadAsync(await session.book.export()); assert.equal(await zip.file('custom/untouched.xml').async('string'), '<keep>original</keep>');
});
test('batch clipboard uses the visible filtered order and rejects malformed or oversized pastes atomically', async () => {
  const source = await fixture(), visible = source.products().reverse();
  assert.equal(balanceNumber('1,234.50'), 1234.5); assert.equal(balanceNumber('0'), 0);
  for (const text of ['', ' ', '-1', 'Infinity', '1,2', '1.2.3']) assert.equal(balanceNumber(text), null);
  const changes = balancePaste(visible, productKey(visible[0]), '2,345.67\r\n0\r\n');
  const session = new MonthlyBatch(source).balances(changes);
  assert.equal(session.book.number(visible[0].sheet, `E${visible[0].row}`), 2345.67);
  assert.equal(session.book.number(visible[1].sheet, `E${visible[1].row}`), 0);
  assert.throws(() => balancePaste(visible.slice(0, 1), productKey(visible[0]), '10\n20'), /超出/);
  assert.throws(() => balancePaste(visible, productKey(visible[0]), '10\n-1'), /无效/);
  assert.throws(() => balancePaste(visible, productKey(visible[0]), '10\t20'), /一列/);
  assert.equal(source.products()[0].balance, 1100);
});
test('batch retains full product editing, transaction edits and additions/deletions until one save or cancellation', async () => {
  const source = await fixture(), p = source.products()[0], key = productKey(p);
  let session = new MonthlyBatch(source).balances([[key, '1300']]);
  session = session.apply(next => { const current = next.products()[0]; next.updateProduct(current, { ...current, name: '已修改名称', note: '完整编辑仍可用' }); }, key);
  assert.equal(session.book.products()[0].balance, 1300); assert.equal(session.book.products()[0].note, '完整编辑仍可用');
  session = session.apply(next => next.saveTransactions(next.products()[0], [{ kind: 'buy', date: '2026-10-01', amount: 1000, shares: 100, price: 10 }]), key);
  assert.equal(session.book.products()[0].balance, 1300); assert.equal(session.book.products()[0].flow, 1000);
  assert.ok(typeof session.book.value(p.sheet, `K${p.row}`) === 'number');
  const reviewed = session.check([key], true);
  session = reviewed.apply(next => next.addProduct(next.products()[0], '批量新增', '新增账户'));
  assert.equal(session.book.products().length, 3); assert.equal(session.reviewed.size, 0);
  const originalProduct = session.book.products().find(x => x.name === '已修改名称'); assert.equal(originalProduct.balance, 1300);
  session = session.apply(next => next.deleteProduct(next.products().find(x => x.name === '批量新增')));
  const reopened = await MonthlyWorkbook.open(await session.book.export()); assert.equal(reopened.products()[0].name, '已修改名称'); assert.equal(reopened.products()[0].balance, 1300);
  assert.equal(source.products().length, 2); assert.equal(source.products()[0].name, 'Assets 示例产品'); assert.equal(source.products()[0].balance, 1100);
  const snapshot = session.book.products()[0].balance;
  assert.throws(() => session.apply(next => { next.set(p.sheet, `E${p.row}`, 999); throw new Error('rejected'); }), /rejected/);
  assert.equal(session.book.products()[0].balance, snapshot);
});

const { flowNumber } = require('../src/pages/MonthlyReview/batch.ts');
const { nextProductSort, sortedProducts } = require('../src/pages/MonthlyReview/sorting.ts');
test('batch supports signed direct net investment, preserves balance edits and blocks invalid hidden fields', async () => {
  const source = await fixture(), p = source.products()[0], key = productKey(p);
  let batch = new MonthlyBatch(source).balances([[key, '1500']]).cashFlows([[key, '-100.50']]);
  assert.equal(batch.book.value(p.sheet, `I${p.row}`), -100.5); assert.equal(batch.book.value(p.sheet, `J${p.row}`), 600.5);
  assert.equal(batch.book.value(p.sheet, `E${p.row}`), 1500); assert.equal(batch.inputs.get(key), '1500');
  assert.equal(source.value(p.sheet, `I${p.row}`), 0);
  for (const text of ['', '-', '1,2', 'NaN']) assert.equal(flowNumber(text), null);
  assert.equal(flowNumber('-1,000.25'), -1000.25); assert.equal(flowNumber('+100'), 100);
  batch = batch.cashFlows([[key, '-']]).balances([[key, '1600']]);
  assert.deepEqual(batch.invalidFlows, [key]); assert.deepEqual(batch.invalidBalances, []); assert.deepEqual(batch.invalid, [key]);
  assert.equal(batch.check([key], true).reviewed.size, 0); assert.throws(() => batch.apply(() => {}), /无效余额或净投入/);
  batch = batch.cashFlows([[key, '200']]); const reopened = await MonthlyWorkbook.open(await batch.book.export());
  assert.equal(reopened.value(p.sheet, `E${p.row}`), 1600); assert.equal(reopened.value(p.sheet, `I${p.row}`), 200); assert.equal(reopened.value(p.sheet, `J${p.row}`), 400);
});
test('product sorting uses raw numbers, orders missing returns last and cycles one field at a time', async () => {
  const book = await fixture(); const a = book.products()[0], b = book.products()[1];
  const rows = [{ ...a, name: '产品10', balance: 9, previous: 1000 }, { ...b, name: '产品2', balance: 1000, previous: 9 }];
  assert.equal(sortedProducts(rows, book, { field: 'name', direction: 'asc' })[0].name, '产品2');
  assert.equal(sortedProducts(rows, book, { field: 'balance', direction: 'asc' })[0].balance, 9);
  assert.equal(sortedProducts(rows, book, { field: 'balance', direction: 'desc' })[0].balance, 1000);
  assert.equal(sortedProducts(rows, book, { field: 'previous', direction: 'asc' })[0].previous, 9);
  assert.equal(sortedProducts(rows, book, { field: 'previous', direction: 'desc' }, new Set([productKey(a)]))[0].previous, 1000);
  for (const [field, col] of [['gain','J'],['xirr','K'],['twr','L']]) {
    book.set(a.sheet, `${col}${a.row}`, -0.1); book.set(b.sheet, `${col}${b.row}`, 0.2);
    assert.equal(sortedProducts(rows, book, { field, direction: 'asc' })[0].sheet, a.sheet);
    assert.equal(sortedProducts(rows, book, { field, direction: 'desc' })[0].sheet, b.sheet);
    book.set(a.sheet, `${col}${a.row}`, '#NUM!');
    for (const direction of ['asc','desc']) assert.equal(sortedProducts(rows, book, { field, direction })[1].sheet, a.sheet);
  }
  const original = rows.map(productKey); sortedProducts(rows, book, { field: 'balance', direction: 'desc' }); assert.deepEqual(rows.map(productKey), original);
  const ascending = nextProductSort(null, 'balance'), descending = nextProductSort(ascending, 'balance');
  assert.equal(ascending.direction, 'asc'); assert.equal(descending.direction, 'desc'); assert.equal(nextProductSort(descending, 'balance'), null);
  assert.deepEqual(nextProductSort(descending, 'gain'), { field:'gain', direction:'asc' });
  const previousAsc = nextProductSort(descending, 'previous'), previousDesc = nextProductSort(previousAsc, 'previous');
  assert.equal(previousAsc.direction, 'asc'); assert.equal(previousDesc.direction, 'desc'); assert.equal(nextProductSort(previousDesc, 'previous'), null);
});

const { isCashAccount } = require('../src/pages/MonthlyReview/categories.ts');
test('cash accounts merge legacy categories and enforce formula net flows across edits, transactions, rollover and export', async () => {
  let book = await fixture(); book.set('Assets', 'B3', 'Current Account'); book.set('WTH', 'B3', 'Monetary Fund'); book.applyCashAccountRules();
  assert.equal(book.products().filter(p => p.category === 'Current Account').length, 2);
  assert.equal(productGroups().filter(g => g.sheet === 'Assets' && g.currency === 'RMB' && g.category === 'Current Account').length, 1);
  assert.equal(productGroups().length, 16);
  const p = book.products()[0], key = productKey(p);
  assert.equal(p.flow, 100); assert.equal(book.cell(p.sheet, `I${p.row}`).formula, `E${p.row}-H${p.row}`);
  const batch = new MonthlyBatch(book).balances([[key, '900.01']]); assert.equal(batch.book.value(p.sheet, `I${p.row}`), -99.99);
  assert.throws(() => batch.cashFlows([[key, '999']]), /不能手动修改/);
  book.updateProduct(p, { ...p, balance: 1200.01, previous: 1000, flow: 999 }); assert.equal(book.products()[0].flow, 200.01);
  const buy = { kind:'buy', date:'2026-10-01', amount:500, shares:50, price:10 };
  book.saveTransactions(book.products()[0], [buy]); assert.equal(book.products()[0].flow, 200.01);
  book.saveTransactions(book.products()[0], [buy, { ...buy, kind:'sell', date:'2026-10-02', amount:500 }]);
  assert.equal(book.products()[0].balance, 1200.01); assert.equal(book.products()[0].flow, 200.01);
  book.rollover('2026-11-30'); assert.equal(book.products()[0].previous, 1200.01); assert.equal(book.products()[0].flow, 0);
  book.set(p.sheet, `E${p.row}`, 1300.02); assert.equal(book.products()[0].flow, 100.01);
  book.set(p.sheet, `I${p.row}`, 9999); book = await MonthlyWorkbook.open(await book.export());
  assert.equal(book.products()[0].flow, 100.01); assert.equal(book.products()[0].sourceCategory,'Current Account'); assert.equal(book.products()[1].sourceCategory,'Monetary Fund');
});
test('new cash accounts need no transactions or manual flow and source category sections survive insertion/deletion', async () => {
  const book = await fixture(); book.set('Assets','B3','Monetary Fund'); book.applyCashAccountRules();
  const anchor = book.products()[0], group = productGroups().find(g => isCashAccount(g.category));
  const p = createProductEntry(book, group.key, {name:'新活期账户',account:'新账户',balance:200.25,flow:NaN,due:'',note:''},'transactions',[]);
  assert.equal(p.flow,200.25); assert.equal(p.previous,0); assert.equal(p.sourceCategory,'Monetary Fund');
  assert.equal(book.cell(p.sheet, `I${p.row}`).formula, `E${p.row}-H${p.row}`);
  book.deleteProduct(p); assert.equal(book.products()[0].name,anchor.name); assert.equal(book.products()[0].sourceCategory,'Monetary Fund');
  assert.equal(book.products()[1].category,'Debt Fund');
});

async function liabilityFixture() {
  const book = await fixture();
  for (const [address, value] of Object.entries({ C1:'Grand Total', C2:'Account', C3:'负债甲', D3:50, H3:10, G3:'每月1日', C4:'负债乙', D4:75, H4:20, G4:serialDate('2026-11-15'), C5:'Sub Total' })) book.set('Liabilities',address,value);
  book.formula('Liabilities','D5','SUM(D3:D4)'); book.formula('Liabilities','D1','D5'); book.formula('Analyze','P3','Liabilities!D1');
  return book;
}
test('liability edits target account rows only and preserve opening balances and repayment types on zeroing', async () => {
  const book = await liabilityFixture(), rows = book.liabilities(); assert.equal(rows.length,2);
  book.updateLiability(rows[0], {balance:0,repayment:String(rows[0].repayment)});
  assert.equal(book.value('Liabilities','D3'),0); assert.equal(book.value('Liabilities','H3'),10); assert.equal(book.value('Liabilities','G3'),'每月1日'); assert.equal(book.number('Liabilities','D1'),75);
  const date = book.value('Liabilities','G4'); book.updateLiability(rows[1],{balance:20.5,repayment:String(date)}); assert.equal(book.value('Liabilities','G4'),date);
  assert.throws(()=>book.updateLiability(rows[0],{balance:-1,repayment:''}),/非负/);
  assert.throws(()=>book.updateLiability({...rows[0],row:5},{balance:0,repayment:''}),/位置/);
  book.updateLiability(book.liabilities()[0],{balance:100.25,repayment:'每月15日'});
  const loaded=await MonthlyWorkbook.open(await book.export());assert.equal(loaded.liabilities()[0].repayment,'每月15日');assert.equal(loaded.liabilities()[0].balance,100.25);assert.equal(loaded.value('Liabilities','H3'),10);assert.equal(loaded.cell('Liabilities','D1').formula,'D5');
});
test('one batch preserves both assets and debts, validates hidden debt inputs and calculates net assets through original formulas', async () => {
  const source=await liabilityFixture(), asset=source.products()[0], debt=source.liabilities()[0], key=productKey(debt);
  let batch=new MonthlyBatch(source).balances([[productKey(asset),'1400'],[key,'90.25']]);
  assert.equal(batch.book.number('Liabilities','D1'),165.25);assert.equal(batch.book.number('Analyze','Q3'),2500-165.25);
  assert.equal(source.number('Liabilities','D3'),50);assert.equal(source.products()[0].balance,1100);assert.ok(batch.changedKeys().has(key));
  batch=batch.check([key],true).balances([[key,'']]);assert.ok(batch.invalid.includes(key));assert.equal(batch.reviewed.has(key),false);assert.throws(()=>batch.apply(()=>{}),/无效余额/);
  batch=batch.balances([[key,'0']]);assert.equal(batch.invalid.length,0);assert.equal(batch.book.number('Liabilities','D3'),0);
  batch=batch.apply(next=>next.updateLiability(next.liabilities()[0],{balance:125.5,repayment:'每月20日'}),key);
  assert.equal(batch.book.products()[0].balance,1400);assert.equal(batch.book.liabilities()[0].repayment,'每月20日');assert.equal(batch.reviewed.has(key),false);
  batch=batch.check([key],true).apply(next=>next.addProduct(next.products()[0],'新增资产','测试账户'));
  assert.equal(batch.reviewed.has(key),true);assert.equal(batch.book.number('Liabilities','D3'),125.5);
  const loaded=await MonthlyWorkbook.open(await batch.book.export());assert.equal(loaded.liabilities()[0].balance,125.5);assert.equal(loaded.liabilities()[0].repayment,'每月20日');assert.equal(loaded.products().find(p=>p.name===asset.name).balance,1400);
});

test('configured groups include USD equity and can create an empty category without counting it inside another category', async () => {
  const b=await fixture(); b.set('Assets','A6','Grand Total'); b.formula('Assets','E6','E4'); b.formula('Assets','D1','E6'); b.formula('Assets','E1','E6'); b.formula('Assets','J6','J4');
  const group=productGroups().find(g=>g.sheet==='Assets'&&g.currency==='RMB'&&g.category==='Equity Fund');
  assert.ok(productGroups().some(g=>g.sheet==='Assets'&&g.currency==='USD'&&g.category==='Equity Fund'));
  const before=b.number('Assets','D1'); const p=createProductEntry(b,group.key,{name:'新分类产品',account:'新账户',balance:120,flow:100,due:'',note:''},'manual');
  assert.equal(p.category,'Equity Fund'); assert.equal(p.currency,'RMB'); assert.equal(p.previous,0); assert.equal(p.flow,100);assert.equal(b.number('Assets','D1'),before+120);assert.equal(b.number('Assets','E4'),1100);assert.ok(p.block);
  const loaded=await MonthlyWorkbook.open(await b.export());assert.equal(loaded.products().find(x=>x.name===p.name).category,'Equity Fund');assert.equal(loaded.number('Assets','D1'),before+120);
  loaded.deleteProduct(loaded.products().find(x=>x.name===p.name));assert.equal(loaded.number('Assets','D1'),before);assert.equal(productGroups().length,16);
});
test('reference missing USD equity category supports trades, FX totals, rollover and Excel roundtrip', {skip:!template}, async()=>{
  const b=await MonthlyWorkbook.open(fs.readFileSync(template)), group=productGroups().find(g=>g.sheet==='Assets'&&g.currency==='USD'&&g.category==='Equity Fund');
  assert.equal(b.products().some(p=>p.sheet==='Assets'&&p.currency==='USD'&&p.category==='Equity Fund'),false);
  const before=b.number('Assets','D1'),rate=b.exchangeRate('USD'), existing=b.products().map(p=>({name:p.name,account:p.account,category:p.category,currency:p.currency,balance:p.balance}));
  let p=createProductEntry(b,group.key,{name:'美元权益基金验证',account:'ZA Bank',balance:2100,flow:2000,due:'',note:''},'manual');
  assert.equal(p.currency,'USD');assert.equal(p.category,'Equity Fund');assert.ok(Math.abs(b.number('Assets','D1')-before-2100*rate)<1e-7);
  b.saveTransactions(p,[{kind:'buy',date:'2026-10-01',amount:2000,shares:200,price:10}]);p=b.products().find(x=>x.name===p.name);assert.equal(typeof b.value(p.sheet,`K${p.row}`),'number');assert.equal(p.flow,2000);
  const loaded=await MonthlyWorkbook.open(await b.export());assert.deepEqual(loaded.products().filter(x=>x.name!==p.name).map(x=>({name:x.name,account:x.account,category:x.category,currency:x.currency,balance:x.balance})),existing);
  assert.equal(loaded.products().find(x=>x.name===p.name).currency,'USD');assert.equal(loaded.exchangeRate('HKD'),0.8513);
  const next=loaded.clone();next.rollover('2026-11-30');const carried=next.products().find(x=>x.name===p.name);assert.equal(carried.previous,2100);assert.equal(carried.flow,0);
  loaded.deleteProduct(loaded.products().find(x=>x.name===p.name));assert.ok(Math.abs(loaded.number('Assets','D1')-before)<1e-7);
});

test('staging keystrokes does not clone the workbook or recalculate cash flow and gains; blur commits once', async()=>{
  const source=await fixture(), p=source.products()[0], key=productKey(p);let batch=new MonthlyBatch(source);const current=batch.book;
  let clones=0;const clone=current.clone.bind(current);current.clone=()=>{clones++;return clone()};
  for(const text of ['2','20','200','2000','2000.','2000.0','2000.01']) { batch=batch.stageBalances([[key,text]]);batch.changedKeys(); }
  batch=batch.stageFlows([[key,'500']]);assert.equal(batch.book,current);assert.equal(clones,0);assert.equal(batch.book.number(p.sheet,`E${p.row}`),1100);assert.equal(batch.book.number(p.sheet,`J${p.row}`),100);assert.equal(batch.dirty,true);assert.ok(batch.changedKeys().has(key));
  const committed=batch.commitInputs();assert.equal(clones,1);assert.equal(committed.book.number(p.sheet,`E${p.row}`),2000.01);assert.equal(committed.book.number(p.sheet,`I${p.row}`),500);assert.equal(committed.book.number(p.sheet,`J${p.row}`),500.01);assert.equal(committed.commitInputs(),committed);
  const loaded=await MonthlyWorkbook.open(await committed.book.export());assert.equal(loaded.number(p.sheet,`E${p.row}`),2000.01);assert.equal(source.number(p.sheet,`E${p.row}`),1100);
});
test('pending inputs flush before review and actions, including cash-account auto flow and debt totals', async()=>{
  const source=await liabilityFixture();source.set('Assets','B3','Current Account');source.applyCashAccountRules();const p=source.products()[0],debt=source.liabilities()[0];
  let batch=new MonthlyBatch(source).stageBalances([[productKey(p),'2000'],[productKey(debt),'25.50']]);assert.equal(batch.book.products()[0].flow,100);assert.equal(batch.book.number('Liabilities','D1'),125);
  batch=batch.check([productKey(p)],true);assert.equal(batch.book.products()[0].flow,1000);assert.equal(batch.book.number('Liabilities','D1'),100.5);assert.equal(batch.reviewed.has(productKey(p)),true);
  batch=batch.stageBalances([[productKey(p),'2500']]).apply(next=>next.updateLiability(next.liabilities()[0],{balance:30,repayment:'每月10日'}),productKey(debt));assert.equal(batch.book.products()[0].balance,2500);assert.equal(batch.book.products()[0].flow,1500);assert.equal(batch.book.liabilities()[0].repayment,'每月10日');
  const invalid=batch.stageBalances([[productKey(debt),'']]);assert.ok(invalid.invalid.includes(productKey(debt)));assert.throws(()=>invalid.apply(()=>{}),/无效/);assert.equal(source.liabilities()[0].balance,50);
});

test('incremental formula invalidation recomputes a row and its cross-sheet dependents while unrelated results stay cached',()=>{
  const cells={'S!A1':{value:10},'S!H1':{value:5},'S!I1':{value:0,formula:'A1-H1'},'S!J1':{value:0,formula:'A1-H1-I1'},'S!B1':{value:7},'S!B2':{value:0,formula:'B1*2'},'Analyze!C1':{value:0,formula:'SUM(S!A1,S!B2)'}};
  const engine=new FormulaEngine((s,a)=>cells[`${s}!${a}`]);assert.equal(engine.get('S','J1'),0);assert.equal(engine.get('Analyze','C1'),24);
  const changed={...cells,'S!A1':{value:20}}, reads={};const fork=engine.fork((s,a)=>{const key=`${s}!${a}`;reads[key]=(reads[key]||0)+1;return changed[key]});
  fork.invalidate('S','A1');assert.equal(fork.get('S','J1'),0);assert.equal(fork.get('S','I1'),15);assert.equal(fork.get('Analyze','C1'),34);assert.equal(fork.get('S','B2'),14);assert.equal(reads['S!B2']||0,0);assert.equal(reads['S!B1']||0,0);assert.equal(reads['S!J1'],1);assert.equal(engine.get('Analyze','C1'),24);
});
test('incremental dependencies track ranges, empty cells, lazy IF branches and cycle recovery',()=>{
  const cells={'S!A1':{value:1},'S!A2':{value:0,formula:'IF(A1=1,B1,C1)'},'S!B1':{value:5},'S!C1':{value:7},'T!A1':{value:0,formula:'SUM(S!D1:D3)'},'S!E1':{value:0,formula:'E2'},'S!E2':{value:0,formula:'E1'}},reads={};
  const e=new FormulaEngine((s,a)=>{const key=`${s}!${a}`;reads[key]=(reads[key]||0)+1;return cells[key]});assert.equal(e.get('S','A2'),5);assert.equal(e.get('T','A1'),0);
  cells['S!D2']={value:9};e.invalidate('S','D2');assert.equal(e.get('T','A1'),9);cells['S!A1']={value:0};e.invalidate('S','A1');assert.equal(e.get('S','A2'),7);const count=reads['S!A2'];cells['S!B1']={value:6};e.invalidate('S','B1');assert.equal(e.get('S','A2'),7);assert.equal(reads['S!A2'],count);
  cells['S!C1']={value:8};e.invalidate('S','C1');assert.equal(e.get('S','A2'),8);assert.equal(e.get('S','E1'),'#CYCLE!');cells['S!E1']={value:3};e.invalidate('S','E1');assert.equal(e.get('S','E2'),3);
});
test('reference incremental row updates match a full Excel reload for every formula', {skip:!template},async()=>{
  const b=await MonthlyWorkbook.open(fs.readFileSync(template));const next=b.clone();next.set('Assets','E3',1234.56);next.set('Assets','E107',1000);next.set('Liabilities','D4',123.45);next.set('Assets','I69',100);
  const full=await MonthlyWorkbook.open(await next.export());let checked=0;
  for(const sheet of next.sheets)for(const address of sheet.cells.keys())if(next.cell(sheet.name,address)?.formula){assert.deepEqual(next.value(sheet.name,address),full.value(sheet.name,address),`${sheet.name}!${address}`);checked++;}
  assert.ok(checked>1000);assert.equal(b.number('Liabilities','D4'),817.85);
});

test('asset and liability search accepts Chinese, full pinyin, initials and mixed account names', () => {
  const { matchesSearch } = require('../src/pages/MonthlyReview/search.ts');
  for (const query of ['招商', 'zhaoshang', 'ZS', 'zhao shang', 'zhaoshang8469', 'zs8469', '8469']) assert.equal(matchesSearch('招商8469', query), true, query);
  for (const query of ['朝朝宝', 'zhaozhaobao', 'zzb']) assert.equal(matchesSearch('朝朝宝 招商银行 债券基金 本人 RMB', query), true, query);
  assert.equal(matchesSearch('美团月付', 'mtyf'), true);
  assert.equal(matchesSearch('美团月付', 'meituanyuefu'), true);
  assert.equal(matchesSearch('CMB-8469', 'cmb'), true);
  assert.equal(matchesSearch('朝朝宝', '基金'), false);
});
test('N/A values and original multiline placeholders display as an em dash', () => {
  const { displayValue } = require('../src/pages/MonthlyReview/display.ts');
  for (const value of [null, '', 'N/A', '#N/A', ' N/A ', 'N/A\ntoo many transactions to calculate']) assert.equal(displayValue(value), '—');
  assert.equal(displayValue(0), '0'); assert.equal(displayValue('1st Day Every Month'), '1st Day Every Month');
});

test('new members, currencies and product types create a required asset and remain editable after export', {skip: !process.env.MONTHLY_TEMPLATE}, async () => {
  const { createAssetGroup } = require('../src/pages/MonthlyReview/product-entry.ts');
  let b=await MonthlyWorkbook.open(fs.readFileSync(process.env.MONTHLY_TEMPLATE));
  const total=b.number('Analyze','O3'), income=b.number('Analyze','O7'), mine=b.number('Assets','D1'), wth=b.number('WTH','D1'), dueThisMonth=b.liquiditySummary()[1];
  const members=b.members().length;
  assert.throws(()=>createAssetGroup(b,{member:'父母',currency:'EUR',category:'其他理财',account:'',name:'',balance:100,rate:8}),/完整/);
  assert.throws(()=>createAssetGroup(b,{member:'父母',currency:'EUR',category:'其他理财',account:'新账户',name:'',balance:100}),/汇率/);
  assert.equal(b.members().length,members);
  let p=createAssetGroup(b,{member:'父母',currency:'eur',category:'其他理财',account:'新账户',name:'',balance:100,rate:8});
  assert.equal(p.name,'新账户'); assert.equal(p.member,'父母'); assert.equal(p.currency,'EUR'); assert.equal(p.previous,0);assert.equal(p.balance,100);assert.equal(p.flow,100);assert.ok(p.block);assert.equal(b.transactions(p.block).length,0);
  assert.equal(b.number('Assets','D1'),mine);assert.equal(b.number('WTH','D1'),wth);assert.equal(b.number('Analyze','O3'),total+800);assert.equal(b.number('Analyze','O7'),income);
  assert.equal(b.members().length,members+1);assert.ok(productGroups(b).some(g=>g.sheet===p.sheet&&g.currency==='EUR'&&g.category==='其他理财'));
  assert.ok(Math.abs(b.liquiditySummary().reduce((a,v)=>a+v,0)-b.number('Analyze','O3'))<1e-7);
  b.updateProduct(p,{...p,balance:110,flow:100});assert.ok(Math.abs(b.number('Analyze','O7')-income-80)<1e-7);
  const exported=await b.export(),zip=await JSZip.loadAsync(exported);const manifest=await zip.file('xl/workbook.xml').async('string'),rels=await zip.file('xl/_rels/workbook.xml.rels').async('string'),types=await zip.file('[Content_Types].xml').async('string');
  assert.match(manifest,/_MR_Config[^>]*state="hidden"/);assert.match(manifest,/Assets-M1/);assert.match(rels,/rIdMonthly/);assert.ok(types.includes(b.sheet(p.sheet).path));
  b=await MonthlyWorkbook.open(exported);p=b.products().find(x=>x.name==='新账户');assert.equal(p.balance,110);assert.equal(p.flow,100);assert.equal(p.member,'父母');assert.equal(b.exchangeRate('EUR'),8);
  b.saveTransactions(p,[{date:'2026-08-01',amount:100,shares:100,price:1,kind:'buy'}]);p=b.products().find(x=>x.name==='新账户');assert.equal(b.transactions(p.block).length,1);assert.equal(typeof b.value(p.sheet,`K${p.row}`),'number');
  b.updateProduct(p,{...p,due:'2026-10-20',balance:110,flow:100}); assert.ok(Math.abs(b.liquiditySummary()[1]-dueThisMonth-880)<1e-7);
  const copy=b.clone();let same=createAssetGroup(copy,{member:'父母',currency:'EUR',category:'其他理财',account:'第二账户',name:'第二产品',balance:10});assert.equal(copy.members().length,members+1);assert.equal(b.products().some(x=>x.name==='第二产品'),false);assert.equal(copy.products().filter(x=>x.member==='父母').length,2);assert.ok(Math.abs(copy.liquiditySummary().reduce((a,v)=>a+v,0)-copy.number('Analyze','O3'))<1e-7);
  copy.deleteProduct(same);assert.equal(copy.products().filter(x=>x.member==='父母').length,1);
  const previous=copy.number('Analyze','O3');copy.rollover('2026-11-01');p=copy.products().find(x=>x.name==='新账户');assert.equal(p.previous,110);assert.equal(copy.number(p.sheet,'H1'),880);assert.equal(copy.number('Analyze','O2'),previous);assert.equal(copy.number('Assets',copy.rateAddress('EUR',true)),8);
  copy.set('Assets',copy.rateAddress('EUR'),9);assert.equal(copy.number(p.sheet,'D1'),990);assert.equal(copy.number(p.sheet,'P1'),110);
  copy.deleteProduct(p);assert.equal(copy.products().some(x=>x.member==='父母'),false);assert.ok(productGroups(copy).some(g=>g.member==='父母'&&g.currency==='EUR'));await MonthlyWorkbook.open(await copy.export());
});
test('new currencies for existing members and new standard types contribute to the correct family totals', {skip: !process.env.MONTHLY_TEMPLATE}, async () => {
  const {createAssetGroup}=require('../src/pages/MonthlyReview/product-entry.ts');const b=await MonthlyWorkbook.open(fs.readFileSync(process.env.MONTHLY_TEMPLATE));
  const total=b.number('Analyze','O3'),usd=b.number('Analyze','P13'),wth=b.number('WTH','D1'),rate=b.exchangeRate('USD');
  const p=createAssetGroup(b,{member:'WTH',currency:'USD',category:'Debt Fund',account:'新美元账户',name:'WTH美元理财',balance:100});
  assert.equal(p.previous,0);assert.ok(Math.abs(b.number('Analyze','O3')-total-100*rate)<1e-7);assert.equal(b.number('Analyze','P13'),usd+100);assert.ok(Math.abs(b.number('WTH','D1')-wth-100*rate)<1e-7);
  const old=b.number('Analyze','O3');createAssetGroup(b,{member:'本人',currency:'JPY',category:'Debt Fund',account:'日元账户',name:'日元资产',balance:1000,rate:0.05});assert.ok(Math.abs(b.number('Analyze','O3')-old-50)<1e-7);
  const before=b.number('Analyze','O3');createAssetGroup(b,{member:'WTH',currency:'RMB',category:'Equity Fund',account:'新基金账户',name:'权益资产',balance:99});assert.equal(b.number('Analyze','O3'),before+99);
  const loaded=await MonthlyWorkbook.open(await b.export());assert.equal(loaded.products().length,b.products().length);assert.ok(Math.abs(loaded.liquiditySummary().reduce((a,v)=>a+v,0)-loaded.number('Analyze','O3'))<1e-7);
});

test('extended workbook parts can be read by ExcelJS with hidden configuration, members and live formulas', async () => {
  const {createAssetGroup}=require('../src/pages/MonthlyReview/product-entry.ts');const b=await fixture();
  for(const s of ['XIRR','XIRR-WTH']) {b.set(s,'A1','Assets');b.set(s,'B1','in RMB');b.set(s,'C2','Product');}
  const p=createAssetGroup(b,{member:'家庭成员',currency:'EUR',category:'债券',account:'欧元账户',name:'',balance:10,rate:8});
  const data=await b.export(), native=new ExcelJS.Workbook();await native.xlsx.load(data);
  assert.equal(native.getWorksheet('_MR_Config').state,'hidden');assert.equal(native.getWorksheet(p.sheet).getCell(`E${p.row}`).value,10);
  assert.ok(native.getWorksheet(p.sheet).getCell('D1').value.formula);assert.equal(native.getWorksheet(p.block.sheet).getCell(`E${p.block.end}`).value.result,10);
  const clone=b.clone();createAssetGroup(clone,{member:'新成员',currency:'RMB',category:'债券',account:'新账户',name:'新资产',balance:1});assert.equal(b.members().some(m=>m.member==='新成员'),false);assert.equal(clone.members().some(m=>m.member==='新成员'),true);
});
