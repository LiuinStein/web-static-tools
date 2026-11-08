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

test('reserved product and account names are rejected before modifying workbook cells', async () => {
  const book = await fixture(), p = book.products()[0];
  const values = { ...p, flow: 0, due: '', note: '' };
  for (const change of [{ name: 'Product' }, { account: 'Exchange Rate:' }, { account: 'Sub Total' }]) {
    assert.throws(() => book.updateProduct(p, { ...values, ...change }), /模板表头/);
    assert.equal(book.products().length, 2);
    assert.equal(book.value(p.sheet, `D${p.row}`), p.name);
    assert.equal(book.value(p.sheet, `C${p.row}`), p.account);
  }
  assert.throws(() => book.addProduct(p, 'Product', '账户'), /模板表头/);
  assert.throws(() => book.addProductGroup({ sheet: 'Assets', currency: 'RMB', category: 'Stock' }, '产品', 'Exchange Rate:'), /模板表头/);
  book.updateProduct(p, { ...values, name: '正常中文产品' });
  const loaded = await MonthlyWorkbook.open(await book.export());
  assert.equal(loaded.products().find(row => row.row === p.row && row.sheet === p.sheet).name, '正常中文产品');
});

test('product balance validation rejects blanks and invalid amounts while accepting explicit zero', () => {
  const { productBalance } = require('../src/pages/MonthlyReview/validation.ts');
  for (const label of ['本期余额', '上期余额']) {
    for (const input of ['', '  ', '-1', 'NaN', 'Infinity', 'abc']) assert.throws(() => productBalance(input, label), new RegExp(label));
    assert.equal(productBalance('0', label), 0);
    assert.equal(productBalance('1234.56', label), 1234.56);
  }
});

test('amount grouping preserves decimal editing and strips separators before parsing', () => {
  const { formatAmount, rawAmount, currencyCode } = require('../src/pages/MonthlyReview/amount.ts');
  for (const [raw, display] of [['1234567.80', '1,234,567.80'], ['-1234.', '-1,234.'], ['', ''], ['-', '-'], ['0.01', '0.01']]) {
    assert.equal(formatAmount(raw), display);
    assert.equal(rawAmount(display), raw);
  }
  assert.equal(currencyCode('CNY'), 'RMB');
});
test('product name sort compares account, then category, then product name', () => {
  const { sortedProducts } = require('../src/pages/MonthlyReview/sorting.ts');
  const rows = [
    { account: 'B', category: 'A', name: 'A' },
    { account: 'A', category: 'B', name: 'A' },
    { account: 'A', category: 'A', name: 'B' },
    { account: 'A', category: 'A', name: 'A' },
  ];
  assert.deepEqual(sortedProducts(rows, {}, { field: 'name', direction: 'asc' }), [...rows].reverse());
  assert.deepEqual(sortedProducts(rows, {}, { field: 'name', direction: 'desc' }), rows);
});
test('product numeric display uses two decimals without changing raw precision', () => {
  const { formatFixedAmount } = require('../src/pages/MonthlyReview/amount.ts');
  assert.equal(formatFixedAmount('1234'), '1,234.00');
  assert.equal(formatFixedAmount('-1234.5'), '-1,234.50');
  assert.equal(formatFixedAmount('1.236'), '1.24');
  assert.equal(formatFixedAmount('0'), '0.00');
  assert.equal(formatFixedAmount(''), '');
  assert.equal(formatFixedAmount('invalid'), 'invalid');
});
test('gain totals add each currency independently and retain valid gains alongside missing results', () => {
  const { sumAvailableAmounts } = require('../src/pages/MonthlyReview/totals.ts');
  const rows = [
    { currency: 'RMB', gain: 100.1 }, { currency: 'USD', gain: 12.2 },
    { currency: 'RMB', gain: -20.2 }, { currency: 'RMB', gain: 'N/A' },
    { currency: 'USD', gain: 0 }, { currency: 'HKD', gain: -3.3 },
  ];
  const total = code => sumAvailableAmounts(rows.filter(row => row.currency === code).map(row => row.gain));
  assert.equal(total('RMB'), 79.9);
  assert.equal(total('USD'), 12.2);
  assert.equal(total('HKD'), -3.3);
  assert.equal(sumAvailableAmounts([0, null, 'N/A']), 0);
  assert.equal(sumAvailableAmounts([null, 'N/A', NaN, Infinity]), null);
});

test('asset dropdown options are linked in all three directions', () => {
  const { linkedOptions } = require('../src/pages/MonthlyReview/filters.ts');
  const rows = [
    { member: '本人', currency: 'RMB', account: '人民币账户' },
    { member: '本人', currency: 'USD', account: '美元账户' },
    { member: 'WTH', currency: 'RMB', account: 'WTH账户' },
  ];
  assert.deepEqual(linkedOptions(rows, { member: 'WTH', currency: '全部', account: '' }).accounts, ['WTH账户']);
  assert.deepEqual(linkedOptions(rows, { member: '本人', currency: 'USD', account: '' }).accounts, ['美元账户']);
  const account = linkedOptions(rows, { member: '全部', currency: '全部', account: '美元账户' });
  assert.deepEqual(account.members, ['本人']);
  assert.deepEqual(account.currencies, ['USD']);
});

test('saved review metadata restores assets and debts without appearing in Excel or new months', async () => {
  const { MonthlyBatch, productKey } = require('../src/pages/MonthlyReview/batch.ts');
  const original = await fixture();
  original.set('Liabilities', 'C3', '信用卡'); original.set('Liabilities', 'D3', 100); original.set('Liabilities', 'H3', 120);
  const asset = original.products()[0], debt = original.liabilities()[0];
  const keys = [productKey(asset), productKey(debt)];
  const completed = new MonthlyBatch(original).balances([[keys[0], '1234.56'], [keys[1], '88.12']]).check(keys, true);
  const metadata = JSON.parse(JSON.stringify(completed.reviewState()));
  const data = await completed.book.export();
  const restoredBook = await MonthlyWorkbook.open(data);
  const restored = MonthlyBatch.restore(restoredBook, metadata);
  assert.deepEqual([...restored.reviewed].sort(), keys.sort());
  for (const key of keys) assert.ok(restored.changedKeys().has(key));
  const edited = restored.balances([[productKey(asset), '1200.12']]);
  assert.ok(!edited.reviewed.has(productKey(asset)));
  assert.ok(restored.reviewed.has(productKey(asset)), 'cancelled edits leave saved marks intact');
  assert.ok(restored.reviewed.has(productKey(debt)));
  const plain = MonthlyBatch.restore(await MonthlyWorkbook.open(data));
  assert.equal(plain.reviewed.size, 0);
  assert.equal(plain.changedKeys().size, 0, 'Excel contains no review metadata');
  const nextBook = await MonthlyWorkbook.open(data);
  nextBook.rollover('2026-11-30');
  const nextMonth = MonthlyBatch.restore(nextBook);
  assert.equal(nextMonth.reviewed.size, 0);
  assert.equal(nextMonth.changedKeys().size, 0);
});

test('amount input retains a typed decimal point across numeric parent updates and formats after blur', () => {
  const React = require('react');
  const originalHook = React.useState, originalEffect = React.useEffect;
  React.useEffect = () => {};
  const oldExtension = require.extensions['.tsx'];
  require.extensions['.tsx'] = (m, f) => m._compile(ts.transpileModule(fs.readFileSync(f, 'utf8'), { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2020, jsx: ts.JsxEmit.React, esModuleInterop: true } }).outputText, f);
  let states = [], cursor = 0;
  React.useState = initial => {
    const index = cursor++;
    if (!(index in states)) states[index] = initial;
    return [states[index], value => { states[index] = value; }];
  };
  try {
    const AmountInput = require('../src/pages/MonthlyReview/AmountInput.tsx').default;
    let value = 1;
    const render = () => { cursor = 0; return AmountInput({ value, onChange: e => { value = Number(e.target.value); } }); };
    let input = render();
    assert.equal(input.props.value, '1.00');
    input.props.onFocus({ currentTarget: { value: '1.00' } });
    input = render();
    input.props.onChange({ target: { value: '1.' } });
    input = render();
    assert.equal(input.props.value, '1.');
    input.props.onChange({ target: { value: '1.25' } });
    assert.equal(value, 1.25);
    input = render();
    assert.equal(input.props.value, '1.25');
    input.props.onBlur({});
    assert.equal(render().props.value, '1.25');
    value = 1234.5;
    assert.equal(render().props.value, '1,234.50');
  } finally {
    React.useState = originalHook;
    React.useEffect = originalEffect;
    if (oldExtension) require.extensions['.tsx'] = oldExtension; else delete require.extensions['.tsx'];
  }
});
test('review-only changes need saving and legacy drafts restore without marks', async () => {
  const { MonthlyBatch, productKey } = require('../src/pages/MonthlyReview/batch.ts');
  const book = await fixture(), key = productKey(book.products()[0]);
  const batch = MonthlyBatch.restore(book);
  assert.equal(batch.dirty, false);
  const checked = batch.check([key], true);
  assert.equal(checked.dirty, true);
  assert.deepEqual(checked.reviewState().reviewed, [key]);
  assert.equal(batch.reviewed.size, 0);
});
test('settings modification marks persist only in local review metadata', async () => {
  const { MonthlyBatch } = require('../src/pages/MonthlyReview/batch.ts');
  const book = await fixture();
  const batch = MonthlyBatch.restore(book).markSettings(['rate:USD', 'salary:本人']);
  const state = JSON.parse(JSON.stringify(batch.reviewState()));
  assert.deepEqual(state.settingsChanged, ['rate:USD', 'salary:本人']);
  assert.deepEqual(state.changed, []);
  const data = await batch.book.export();
  const reopened = await MonthlyWorkbook.open(data);
  assert.deepEqual(MonthlyBatch.restore(reopened, state).reviewState().settingsChanged, state.settingsChanged);
  assert.deepEqual(MonthlyBatch.restore(reopened).reviewState().settingsChanged, []);
  assert.deepEqual(batch.apply(next => next.addProduct(book.products()[0], 'New settings test product', 'New account')).reviewState().settingsChanged, state.settingsChanged);
});

test('performance benchmarks apply four exact boundary bands only to the selected metric', () => {
  const { benchmarkRating, parseBenchmarks } = require('../src/pages/MonthlyReview/benchmarks.ts');
  const config = parseBenchmarks(null);
  const band = value => benchmarkRating(config, 'Stock', 'xirr', value).className;
  assert.equal(band(0.2), 'mr-performance-high');
  assert.equal(band(0.19999), 'mr-performance-middle');
  assert.equal(band(0.1), 'mr-performance-middle');
  assert.equal(band(0.09999), 'mr-performance-low');
  assert.equal(band(0.05), 'mr-performance-low');
  assert.equal(band(0.04999), 'mr-performance-below');
  assert.equal(band(0), 'mr-performance-below');
  assert.equal(band(-0.1), 'mr-performance-below');
  for (const value of [null, '', 'N/A', '#NUM!', NaN, Infinity]) assert.equal(band(value), undefined);
  assert.equal(benchmarkRating(config, 'Stock', 'twr', 0.2).className, undefined);
  const switched = { ...config, Stock: { ...config.Stock, metric: 'twr' } };
  assert.equal(benchmarkRating(switched, 'Stock', 'xirr', 0.2).className, undefined);
  assert.equal(benchmarkRating(switched, 'Stock', 'twr', 0.2).className, 'mr-performance-high');
  assert.equal(benchmarkRating(undefined, 'Stock', 'xirr', 0.2).className, undefined);
});

test('benchmark defaults, disabled types, custom categories and persisted configuration are validated', () => {
  const { benchmarkFor, benchmarkRating, parseBenchmarks, validBenchmark } = require('../src/pages/MonthlyReview/benchmarks.ts');
  const config = parseBenchmarks(null);
  assert.deepEqual(config['Debt Fund'], { metric: 'xirr', high: 5, middle: 3, low: 2 });
  for (const category of ['Stock', 'Equity Fund']) assert.deepEqual(config[category], { metric: 'xirr', high: 20, middle: 10, low: 5 });
  for (const category of ['Time Deposit', 'Current Account', 'Monetary Fund', 'Custom']) {
    assert.equal(benchmarkFor(config, category).metric, 'none');
    assert.equal(benchmarkRating(config, category, 'xirr', 1).className, undefined);
  }
  assert.equal(benchmarkRating(config, 'Debt Fund', 'xirr', 0.03).className, 'mr-performance-middle');
  const saved = parseBenchmarks(JSON.stringify({ Stock: { metric: 'none', high: 20, middle: 10, low: 5 }, 'Debt Fund': { metric: 'twr', high: 4.5, middle: 3.25, low: -1 } }));
  assert.equal(saved.Stock.metric, 'none');
  assert.equal(benchmarkRating(saved, 'Debt Fund', 'twr', -0.01).className, 'mr-performance-low');
  assert.equal(parseBenchmarks('bad json').Stock.high, 20);
  for (const rule of [
    { metric: 'xirr', high: 10, middle: 10, low: 5 },
    { metric: 'xirr', high: 5, middle: 10, low: 2 },
    { metric: 'both', high: 20, middle: 10, low: 5 },
    { metric: 'xirr', high: '20', middle: 10, low: 5 },
    { metric: 'xirr', high: Infinity, middle: 10, low: 5 },
  ]) assert.equal(validBenchmark(rule), false);
});

test('inline note edits preserve financial cells, support multiline clearing and respect batch isolation', async () => {
  const { MonthlyBatch, productKey } = require('../src/pages/MonthlyReview/batch.ts');
  const original = await fixture(), product = original.products()[0];
  const addresses = ['B', 'C', 'D', 'E', 'F', 'G', 'H', 'I', 'J', 'K', 'L', 'M'].map(column => column + product.row);
  const before = addresses.map(address => original.cell(product.sheet, address));
  const key = productKey(product), note = '第一行备注\n第二行 <原样保留>';
  const batch = new MonthlyBatch(original).check([key], true).apply(next => next.updateProductNote(product, note), key);
  assert.equal(original.products()[0].note, '');
  assert.equal(batch.book.products()[0].note, note);
  assert.ok(!batch.reviewed.has(key));
  assert.ok(batch.changedKeys().has(key));
  assert.deepEqual(addresses.map(address => batch.book.cell(product.sheet, address)), before);
  const reopened = await MonthlyWorkbook.open(await batch.book.export());
  const saved = reopened.products().find(p => productKey(p) === key);
  assert.equal(saved.note, note);
  reopened.updateProductNote(saved, '');
  assert.equal(reopened.products().filter(p => p.note.trim()).length, 0);
  assert.throws(() => reopened.updateProductNote({ ...saved, account: 'Wrong account' }, 'wrong'), /产品位置已变化/);
  assert.equal(reopened.products()[0].note, '');
});

test('new liability accounts expand totals and cross-sheet references, survive Excel and roll over', async () => {
  const book = await liabilityFixture();
  book.formula('Liabilities', 'H5', 'SUM(H3:H4)');
  book.formula('Analyze', 'R1', "SUM('Liabilities'!$D$3:$D$4)");
  book.formula('Analyze', 'S1', 'SUM(Assets!D3:D4)');
  book.formula('Analyze', 'T1', 'IF(1=1,"Liabilities!D3:D4",0)');
  const previousRows = book.liabilities();
  const assets = book.number('Analyze', 'O3');
  const created = book.addLiability({ account: ' 新信用账户 ', balance: 25.5, repayment: ' 每月20日 ' });
  assert.equal(created.account, '新信用账户');
  assert.equal(created.previous, 0);
  assert.equal(created.balance, 25.5);
  assert.equal(created.repayment, '每月20日');
  assert.deepEqual(book.liabilities().slice(0, 2), previousRows);
  assert.equal(book.number('Liabilities', 'D1'), 150.5);
  assert.equal(book.number('Analyze', 'R1'), 150.5);
  assert.equal(book.number('Analyze', 'Q3'), assets - 150.5);
  assert.equal(book.cell('Liabilities', 'D1').formula, 'D6');
  assert.equal(book.cell('Liabilities', 'D6').formula, 'SUM(D3:D5)');
  assert.equal(book.number('Liabilities', 'H6'), 30);
  assert.equal(book.cell('Analyze', 'S1').formula, 'SUM(Assets!D3:D4)');
  assert.equal(book.cell('Analyze', 'T1').formula, 'IF(1=1,"Liabilities!D3:D4",0)');
  const loaded = await MonthlyWorkbook.open(await book.export());
  assert.equal(loaded.liabilities().find(row => row.account === '新信用账户').balance, 25.5);
  assert.equal(loaded.number('Liabilities', 'D1'), 150.5);
  loaded.rollover('2026-11-30');
  assert.equal(loaded.liabilities().find(row => row.account === '新信用账户').previous, 25.5);
  assert.equal(loaded.number('Liabilities', 'F1'), 150.5);
});

test('liability additions validate before mutation, work in empty tables and remain isolated in batches', async () => {
  const source = await liabilityFixture(), rows = source.liabilities();
  for (const values of [
    { account: '', balance: 1 }, { account: rows[0].account, balance: 1 },
    { account: 'Sub Total', balance: 1 }, { account: 'New', balance: -1 }, { account: 'New', balance: NaN },
  ]) {
    assert.throws(() => source.addLiability({ ...values, repayment: '' }));
    assert.equal(source.liabilities().length, 2);
    assert.equal(source.number('Liabilities', 'D1'), 125);
  }
  const assetKey = productKey(source.products()[0]), debtKey = productKey(rows[0]);
  const batch = new MonthlyBatch(source).check([assetKey, debtKey], true).apply(next => next.addLiability({ account: 'Batch debt', balance: 0.01, repayment: '' }));
  assert.equal(source.liabilities().length, 2);
  assert.equal(batch.book.liabilities().length, 3);
  assert.equal(batch.book.number('Liabilities', 'D1'), 125.01);
  assert.ok(batch.reviewed.has(assetKey));
  assert.ok(batch.reviewed.has(debtKey));
  const added = batch.book.liabilities().find(row => row.account === 'Batch debt');
  assert.ok(batch.changedKeys().has(productKey(added)));
  assert.ok(!batch.changedKeys().has(debtKey));
  const empty = await fixture();
  empty.set('Liabilities', 'D1', 0);
  empty.addLiability({ account: 'First debt', balance: 1234.56, repayment: '' });
  empty.addLiability({ account: 'Second debt', balance: 1.24, repayment: '' });
  assert.equal(empty.liabilities().length, 2);
  assert.equal(empty.number('Liabilities', 'D1'), 1235.8);
});

test('recurring repayment schedules parse English and Chinese and serialize correct ordinal suffixes', () => {
  const { parseRepayment, repaymentForm, encodeRepayment } = require('../src/pages/MonthlyReview/repayment.ts');
  for (const day of Array.from({ length: 31 }, (_, i) => i + 1)) for (const months of [1, 2, 3, 4, 6, 12, 24]) {
    const encoded = encodeRepayment({ ...repaymentForm(null), day: String(day), months: String(months) });
    assert.deepEqual(parseRepayment(encoded), { day, months });
  }
  assert.equal(encodeRepayment({ ...repaymentForm(null), day: '1' }), '1st Day Every Month');
  assert.equal(encodeRepayment({ ...repaymentForm(null), day: '22', months: '2' }), '22nd Day Every 2 Months');
  for (const [day, suffix] of [[2, 'nd'], [3, 'rd'], [11, 'th'], [12, 'th'], [13, 'th'], [21, 'st'], [23, 'rd'], [31, 'st']]) {
    assert.ok(encodeRepayment({ ...repaymentForm(null), day: String(day) }).startsWith(day + suffix + ' '));
  }
  for (const text of ['22nd Day Every 2 Months', '22nd Day Every Other Month', '22nd Day Every Two Months', '每2个月22日', '每双月22日']) assert.deepEqual(parseRepayment(text), { day: 22, months: 2 });
  assert.deepEqual(parseRepayment('每月1日'), { day: 1, months: 1 });
  assert.deepEqual(parseRepayment('31st Day Every Quarter'), { day: 31, months: 3 });
  assert.equal(repaymentForm('31st Day Every 4 Months').customInterval, true);
  assert.equal(repaymentForm('31st Day Every Month').customInterval, false);
});

test('repayment inputs validate integer day and interval while preserving unrecognized legacy values', () => {
  const { parseRepayment, repaymentForm, encodeRepayment, liabilityGrowthClass } = require('../src/pages/MonthlyReview/repayment.ts');
  for (const day of ['0', '32', '-1', '1.5', 'abc', '1e1']) assert.throws(() => encodeRepayment({ ...repaymentForm(null), day }), /1–31/);
  for (const months of ['', '0', '-2', '1.5', 'text', '9007199254740992']) assert.throws(() => encodeRepayment({ ...repaymentForm(null), day: '22', months }), /月份间隔/);
  for (const text of ['32nd Day Every Month', '22nd Day Every 0 Months', '2026-12-01']) assert.equal(parseRepayment(text), null);
  for (const value of ['2026-12-01', '原模板特殊规则', serialDate('2026-12-01')]) {
    const form = repaymentForm(value);
    assert.equal(form.mode, value === '原模板特殊规则' ? 'legacy' : 'once');
    assert.equal(encodeRepayment(form), String(value));
  }
  assert.equal(encodeRepayment(repaymentForm(null)), '');
  assert.equal(encodeRepayment({ ...repaymentForm('1st Day Every Month'), mode: 'none' }), '');
  assert.equal(liabilityGrowthClass(1), 'mr-debt-increase');
  assert.equal(liabilityGrowthClass(-1), 'mr-debt-decrease');
  for (const value of [0, -0, NaN, Infinity]) assert.equal(liabilityGrowthClass(value), undefined);
});

test('new and edited liability schedules survive Excel roundtrip without changing numeric legacy dates', async () => {
  const { repaymentForm, encodeRepayment } = require('../src/pages/MonthlyReview/repayment.ts');
  const book = await liabilityFixture();
  const numeric = book.liabilities()[1];
  book.updateLiability(numeric, { balance: 88.1, repayment: encodeRepayment(repaymentForm(numeric.repayment)) });
  assert.equal(typeof book.value('Liabilities', 'G4'), 'number');
  const schedule = encodeRepayment({ ...repaymentForm(null), day: '22', months: '2' });
  const added = book.addLiability({ account: '双月账户', balance: 100.01, repayment: schedule });
  const reopened = await MonthlyWorkbook.open(await book.export());
  const row = reopened.liabilities().find(p => p.account === added.account);
  assert.deepEqual(repaymentForm(row.repayment), { mode: 'recurring', day: '22', months: '2', original: '22nd Day Every 2 Months', customInterval: false, date: '', originalDate: '' });
  reopened.updateLiability(row, { balance: row.balance, repayment: encodeRepayment({ ...repaymentForm(row.repayment), day: '31', months: '12' }) });
  assert.equal(reopened.liabilities().find(p => p.account === row.account).repayment, '31st Day Every 12 Months');
});

test('one-time payoff dates validate, parse legacy dates and preserve numeric Excel date types', async () => {
  const { repaymentDate, repaymentForm, encodeRepayment } = require('../src/pages/MonthlyReview/repayment.ts');
  for (const date of ['2026-12-22', '2028-02-29', '2027-01-01']) {
    const form = { ...repaymentForm(null), mode: 'once', date };
    assert.equal(encodeRepayment(form), date);
    assert.equal(repaymentForm(date).mode, 'once');
    assert.equal(repaymentForm(date).date, date);
  }
  assert.equal(repaymentDate('2027/1/2'), '2027-01-02');
  for (const date of ['', '2027-02-29', '2027-04-31', 'bad', '2027-13-01']) assert.throws(() => encodeRepayment({ ...repaymentForm(null), mode: 'once', date }), /还清日期/);
  assert.equal(repaymentDate(Infinity), '');
  const book = await liabilityFixture(), numeric = book.liabilities()[1];
  const form = repaymentForm(numeric.repayment);
  assert.equal(form.mode, 'once');
  assert.equal(form.date, '2026-11-15');
  book.updateLiability(numeric, { balance: 10, repayment: encodeRepayment(form) });
  assert.equal(book.value('Liabilities', 'G4'), numeric.repayment);
  assert.equal(typeof book.value('Liabilities', 'G4'), 'number');
  book.updateLiability(numeric, { balance: 10, repayment: encodeRepayment({ ...form, date: '2027-01-22' }) });
  assert.equal(book.value('Liabilities', 'G4'), '2027-01-22');
  const added = book.addLiability({ account: '一次性还清账户', balance: 500, repayment: encodeRepayment({ ...repaymentForm(null), mode: 'once', date: '2027-06-30' }) });
  const reopened = await MonthlyWorkbook.open(await book.export());
  const saved = reopened.liabilities().find(row => row.account === added.account);
  assert.equal(repaymentForm(saved.repayment).mode, 'once');
  assert.equal(repaymentForm(saved.repayment).date, '2027-06-30');
  assert.equal(encodeRepayment({ ...repaymentForm(saved.repayment), mode: 'recurring', day: '22', months: '2' }), '22nd Day Every 2 Months');
  assert.equal(encodeRepayment({ ...repaymentForm(saved.repayment), mode: 'none' }), '');
});

test('performance band filter uses each type and selected metric with consistent inclusive boundaries', () => {
  const { parseBenchmarks, matchesBenchmarkBand } = require('../src/pages/MonthlyReview/benchmarks.ts');
  const config = parseBenchmarks(null);
  config['Equity Fund'] = { metric: 'twr', high: 20, middle: 10, low: 5 };
  const rows = [
    ['stock-high', 'Stock', 0.2, -0.2],
    ['stock-middle', 'Stock', 0.1, 0.9],
    ['stock-low', 'Stock', 0.05, 0.9],
    ['stock-below', 'Stock', 0.04999, 0.9],
    ['bond-high', 'Debt Fund', 0.15, null],
    ['twr-middle', 'Equity Fund', 0.9, 0.1],
    ['unconfigured', 'Time Deposit', 0.9, 0.9],
    ['missing', 'Stock', 'N/A', 0.9],
    ['invalid', 'Stock', NaN, 0.9],
  ];
  const match = band => rows.filter(([, category, xirr, twr]) => matchesBenchmarkBand(config, category, xirr, twr, band)).map(row => row[0]);
  assert.deepEqual(match('high'), ['stock-high', 'bond-high']);
  assert.deepEqual(match('middle'), ['stock-middle', 'twr-middle']);
  assert.deepEqual(match('low'), ['stock-low']);
  assert.deepEqual(match('below'), ['stock-below']);
  assert.equal(match('all').length, rows.length);
  assert.equal(matchesBenchmarkBand({ ...config, Stock: { ...config.Stock, metric: 'none' } }, 'Stock', 0.9, 0.9, 'high'), false);
});

test('benchmark dropdown, legend and cell tooltip share inequality interval descriptions', () => {
  const { benchmarkIntervalLabel, benchmarkRating, parseBenchmarks } = require('../src/pages/MonthlyReview/benchmarks.ts');
  assert.equal(benchmarkIntervalLabel('high', 'XIRR'), 'XIRR ≥ 高档');
  assert.equal(benchmarkIntervalLabel('middle', 'XIRR'), '中档 ≤ XIRR < 高档');
  assert.equal(benchmarkIntervalLabel('low', '年化 TWR'), '低档 ≤ 年化 TWR < 中档');
  assert.equal(benchmarkIntervalLabel('below', 'XIRR'), 'XIRR＜低档');
  assert.equal(benchmarkIntervalLabel('low'), '低档 ≤ XIRR（或年化 TWR） < 中档');
  assert.ok(benchmarkRating(parseBenchmarks(null), 'Stock', 'xirr', 0.05).title.startsWith('低档 ≤ XIRR < 中档'));
});

test('return analysis preserves zero and missing rates and converts current balances without mutating workbook cells', async () => {
  const { returnRows, returnSummary, median } = require('../src/pages/MonthlyReview/return-analysis.ts');
  const book = await fixture();
  book.set('Assets', 'K3', 0); book.set('Assets', 'L3', '#NUM!');
  book.set('WTH', 'K3', -0.1); book.set('WTH', 'L3', 0.03);
  const products = book.products(), before = book.cell('Assets', 'E3');
  const rows = returnRows(book, products);
  assert.equal(rows[0].xirr, 0);
  assert.equal(rows[0].twr, null);
  const summary = returnSummary(rows, 'xirr');
  assert.equal(summary.median, -0.05);
  assert.equal(summary.balanceRmb, 2200);
  assert.deepEqual([summary.valid, summary.flat, summary.negative, summary.positive], [2, 1, 1, 0]);
  assert.deepEqual([returnSummary(rows, 'twr').valid, returnSummary(rows, 'twr').missing], [1, 1]);
  assert.equal(median([0.1, 0.2]), 0.15);
  assert.equal(median([null, NaN, Infinity]), null);
  assert.equal(returnSummary([], 'xirr').median, null);
  const invalid = returnRows(book, products, [productKey(products[0])]);
  assert.equal(invalid[0].xirr, null);
  assert.equal(invalid[0].balanceRmb, null);
  assert.equal(returnSummary(invalid, 'xirr').missingBalance, 1);
  assert.deepEqual(book.cell('Assets', 'E3'), before);
  const foreign = [{ ...products[0], currency: 'USD', balance: 0.1 }, { ...products[1], currency: 'MISSING', balance: 10 }];
  const converted = returnRows(book, foreign);
  assert.equal(converted[0].balanceRmb, 0.7);
  assert.equal(converted[1].balanceRmb, null);
  assert.equal(returnSummary(converted, 'xirr').balanceRmb, 0.7);
});

test('return analysis groups medians rather than aggregating product rates and ranks missing values last', () => {
  const { compareReturns, rankReturns, rateRange, distribution, RETURN_RANGES } = require('../src/pages/MonthlyReview/return-analysis.ts');
  const row = (id, member, currency, category, xirr, balanceRmb) => ({ id, product: { name: id, member, currency, category }, xirr, twr: null, balanceRmb });
  const rows = [
    row('a', '本人', 'RMB', 'Stock', 0.2, 100),
    row('b', '本人', 'USD', 'Stock', -0.1, 900),
    row('c', 'WTH', 'RMB', 'Debt Fund', 0.03, 100),
    row('d', 'WTH', 'HKD', 'Debt Fund', null, null),
  ];
  const groups = compareReturns(rows, 'xirr', 'category');
  assert.equal(groups[0].key, 'Stock');
  assert.equal(groups[0].median, 0.05);
  assert.equal(groups[0].balanceRmb, 1000);
  assert.equal(groups[1].median, 0.03);
  assert.equal(groups[1].valid, 1);
  assert.equal(groups[1].count, 2);
  assert.equal(compareReturns(rows, 'xirr', 'member').length, 2);
  assert.equal(compareReturns(rows, 'xirr', 'currency').length, 3);
  assert.deepEqual(rankReturns(rows, 'xirr', 'desc').map(r => r.id), ['a', 'c', 'b', 'd']);
  assert.deepEqual(rankReturns(rows, 'xirr', 'asc').map(r => r.id), ['b', 'c', 'a', 'd']);
  for (const [value, band] of [[0.2, 'high'], [0.1, 'middle'], [0.05, 'low'], [0, 'base'], [-0.01, 'negative'], [null, 'missing']]) assert.equal(rateRange(value), band);
  const buckets = distribution(rows, RETURN_RANGES, r => rateRange(r.xirr));
  assert.equal(buckets.reduce((sum, b) => sum + b.count, 0), 4);
  assert.equal(buckets.find(b => b.key === 'missing').count, 1);
  assert.equal(rows[0].id, 'a', 'sorting leaves the source array unchanged');
});

test('benchmark return analysis respects type-specific metrics and keeps unconfigured and missing results separate', () => {
  const { parseBenchmarks } = require('../src/pages/MonthlyReview/benchmarks.ts');
  const { benchmarkBucket, distribution, BENCHMARK_BUCKETS } = require('../src/pages/MonthlyReview/return-analysis.ts');
  const config = parseBenchmarks(null);
  config['Equity Fund'].metric = 'twr';
  const rows = [
    { product: { category: 'Stock' }, xirr: 0.2, twr: -0.3, balanceRmb: 100 },
    { product: { category: 'Debt Fund' }, xirr: 0.03, twr: 1, balanceRmb: 200 },
    { product: { category: 'Equity Fund' }, xirr: -0.5, twr: 0.1, balanceRmb: 300 },
    { product: { category: 'Time Deposit' }, xirr: 1, twr: 1, balanceRmb: 400 },
    { product: { category: 'Stock' }, xirr: null, twr: 0.3, balanceRmb: 500 },
  ];
  assert.deepEqual(rows.map(r => benchmarkBucket(r, config)), ['high', 'middle', 'middle', 'unconfigured', 'missing']);
  const groups = distribution(rows, BENCHMARK_BUCKETS, r => benchmarkBucket(r, config));
  assert.equal(groups.find(g => g.key === 'middle').count, 2);
  assert.equal(groups.find(g => g.key === 'middle').balanceRmb, 500);
  assert.equal(groups.find(g => g.key === 'unconfigured').count, 1);
  assert.equal(groups.find(g => g.key === 'missing').count, 1);
});

test('return analysis overview renders all three analysis views and handles empty and missing data', async () => {
  const oldExtension = require.extensions['.tsx'];
  require.extensions['.tsx'] = (m, f) => m._compile(ts.transpileModule(fs.readFileSync(f, 'utf8'), { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2020, jsx: ts.JsxEmit.React, esModuleInterop: true } }).outputText, f);
  try {
    const React = require('react'), { renderToStaticMarkup } = require('react-dom/server');
    const ReturnAnalysis = require('../src/pages/MonthlyReview/ReturnAnalysis.tsx').default;
    const { parseBenchmarks } = require('../src/pages/MonthlyReview/benchmarks.ts');
    const book = await fixture();
    book.set('Assets', 'K3', 0.2);
    const props = { book, products: book.products(), benchmarks: parseBenchmarks(null), categoryNames: { 'Debt Fund': '债券基金 / 理财' }, invalidKeys: [], onViewProduct: () => {} };
    const html = renderToStaticMarkup(React.createElement(ReturnAnalysis, props));
    for (const text of ['收益率分析', 'XIRR 分布', '分组比较', '产品排行', '业绩基准达标情况', '收益率分析指标', '查看资产']) assert.ok(html.includes(text), text);
    assert.ok(!html.includes('NaN'));
    const empty = renderToStaticMarkup(React.createElement(ReturnAnalysis, { ...props, products: [] }));
    assert.ok(empty.includes('当前筛选范围没有产品'));
    assert.ok(empty.includes('没有符合当前筛选条件的产品'));
    assert.ok(!empty.includes('NaN'));
  } finally {
    if (oldExtension) require.extensions['.tsx'] = oldExtension; else delete require.extensions['.tsx'];
  }
});

test('distribution detail selection matches the clicked bucket and retains all scoped products', () => {
  const { returnDetailRows } = require('../src/pages/MonthlyReview/return-analysis.ts');
  const { parseBenchmarks } = require('../src/pages/MonthlyReview/benchmarks.ts');
  const config = parseBenchmarks(null);
  config['Equity Fund'].metric = 'twr';
  const rows = [
    { id: 'a', product: { category: 'Stock' }, xirr: 0.2, twr: 0.01 },
    { id: 'b', product: { category: 'Stock' }, xirr: 0.05, twr: 0.2 },
    { id: 'c', product: { category: 'Equity Fund' }, xirr: -0.1, twr: 0.2 },
    { id: 'd', product: { category: 'Time Deposit' }, xirr: 0.2, twr: 0 },
    { id: 'e', product: { category: 'Stock' }, xirr: null, twr: 0.2 },
  ];
  assert.deepEqual(returnDetailRows(rows, config, { kind: 'range', key: 'high', metric: 'xirr' }).map(r => r.id), ['a', 'd']);
  assert.deepEqual(returnDetailRows(rows, config, { kind: 'range', key: 'high', metric: 'twr' }).map(r => r.id), ['b', 'c', 'e']);
  assert.deepEqual(returnDetailRows(rows, config, { kind: 'benchmark', key: 'high' }).map(r => r.id), ['a', 'c']);
  assert.deepEqual(returnDetailRows(rows, config, { kind: 'benchmark', key: 'unconfigured' }).map(r => r.id), ['d']);
  assert.deepEqual(returnDetailRows(rows, config, { kind: 'benchmark', key: 'missing' }).map(r => r.id), ['e']);
  assert.deepEqual(returnDetailRows(rows.slice(0, 1), config, { kind: 'benchmark', key: 'high' }).map(r => r.id), ['a']);
  assert.equal(rows.length, 5);
});

test('clicking return and benchmark distribution entries opens scoped product details with balances and rates', async () => {
  const book = await fixture();
  book.set('Assets', 'K3', 0.2); book.set('WTH', 'K3', 0.1);
  const React = require('react');
  const original = { useState: React.useState, useMemo: React.useMemo, useEffect: React.useEffect };
  const extension = require.extensions['.tsx'];
  require.extensions['.tsx'] = (m, f) => m._compile(ts.transpileModule(fs.readFileSync(f, 'utf8'), { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2020, jsx: ts.JsxEmit.React, esModuleInterop: true } }).outputText, f);
  let states = [], memos = [], cursor = 0;
  React.useState = value => {
    const index = cursor++;
    if (!(index in states)) states[index] = typeof value === 'function' ? value() : value;
    return [states[index], next => { states[index] = typeof next === 'function' ? next(states[index]) : next; }];
  };
  React.useMemo = (fn, deps) => {
    const index = cursor++, previous = memos[index];
    if (!previous || previous.deps.length !== deps.length || deps.some((value, i) => !Object.is(value, previous.deps[i]))) memos[index] = { deps: [...deps], value: fn() };
    return memos[index].value;
  };
  React.useEffect = () => {};
  const nodes = node => !node || typeof node !== 'object' ? [] : Array.isArray(node) ? node.flatMap(nodes) : [node, ...nodes(node.props?.children)];
  const text = node => Array.isArray(node) ? node.map(text).join('') : node && typeof node === 'object' ? text(node.props?.children) : node == null || node === false ? '' : String(node);
  const analysis = require('../src/pages/MonthlyReview/return-analysis.ts');
  const watched = ['returnRows', 'returnSummary', 'distribution', 'compareReturns', 'rankReturns', 'returnDetailRows'];
  const counters = {}, functions = {};
  for (const key of watched) {
    functions[key] = analysis[key]; counters[key] = 0;
    analysis[key] = (...args) => { counters[key]++; return functions[key](...args); };
  }
  try {
    const Component = require('../src/pages/MonthlyReview/ReturnAnalysis.tsx').default;
    const { parseBenchmarks } = require('../src/pages/MonthlyReview/benchmarks.ts');
    const props = { book, products: book.products(), benchmarks: parseBenchmarks(null), categoryNames: {}, invalidKeys: [], onViewProduct: () => {} };
    const render = () => { cursor = 0; return Component(props); };
    const dialog = tree => nodes(tree).find(node => node.props?.className?.includes('mr-return-details'));
    const charts = tree => nodes(tree).filter(node => node.type === 'button' && node.props['aria-haspopup'] === 'dialog');
    let tree = render();
    const rankingFilter = tree => nodes(tree).find(node => node.type === 'select' && node.props['aria-label'] === '产品排行筛选');
    assert.equal(rankingFilter(tree).props.value, 'all');
    charts(tree)[0].props.onClick();
    assert.equal(rankingFilter(render()).props.value, 'all', 'opening a return distribution must not filter the ranking');
    let modal = dialog(render());
    assert.equal(modal.props.visible, true);
    assert.ok(modal.props.title.includes('XIRR'));
    assert.equal(nodes(modal).find(node => node.type === 'tbody').props.children.length, 1);
    assert.ok(text(modal).includes('当期金额（原币）'));
    assert.ok(text(modal).includes('1,100.00'));
    assert.ok(text(modal).includes('20.00%'));
    charts(render())[6].props.onClick();
    assert.equal(rankingFilter(render()).props.value, 'all', 'opening the high benchmark bucket must not apply band:high to the ranking');
    modal = dialog(render());
    assert.equal(nodes(modal).find(node => node.type === 'tbody').props.children.length, 2);
    assert.ok(text(modal).includes('基准指标'));
    nodes(render()).find(node => node.type === 'select' && node.props['aria-label'] === '收益分析成员').props.onChange({ target: { value: 'WTH' } });
    charts(render())[6].props.onClick();
    modal = dialog(render());
    assert.equal(nodes(modal).find(node => node.type === 'tbody').props.children.length, 1);
    assert.ok(text(modal).includes('WTH 示例产品'));
    const beforeClose = { ...counters };
    const table = nodes(modal).find(node => node.type === 'div' && node.props.className === 'mr-table-wrap');
    assert.equal(modal.props.animation, false);
    assert.equal(modal.props.overlayProps.cache, true);
    assert.ok(modal.props.closeMode.includes('mask'));
    modal.props.onClose('maskClick');
    let closed = dialog(render());
    assert.equal(closed.props.visible, false);
    assert.deepEqual(counters, beforeClose, 'closing must not rerun statistics, sorting or detail filtering');
    assert.equal(nodes(closed).find(node => node.type === 'div' && node.props.className === 'mr-table-wrap'), table, 'retain the exact table subtree while hiding');
    for (let repeat = 0; repeat < 3; repeat++) {
      charts(render())[6].props.onClick();
      const reopened = dialog(render());
      assert.equal(reopened.props.visible, true);
      assert.deepEqual(counters, beforeClose, 'reopening unchanged data reuses cached analysis');
      reopened.props.onClose('maskClick');
      closed = dialog(render());
      assert.equal(closed.props.visible, false);
      assert.deepEqual(counters, beforeClose);
    }
    const ranking = tree => nodes(tree).find(node => node.type === 'article' && node.props.className?.includes('mr-return-ranking'));
    const countRows = tree => nodes(ranking(tree)).find(node => node.type === 'tbody').props.children.length;
    const filter = tree => nodes(tree).find(node => node.type === 'select' && node.props['aria-label'] === '产品排行筛选');
    const controls = nodes(ranking(render())).filter(node => node.type === 'select').map(node => node.props['aria-label']);
    assert.deepEqual(controls, ['产品排行筛选', '收益率排行顺序', '收益率排行显示数量']);
    filter(render()).props.onChange({ target: { value: 'range:high' } });
    assert.equal(countRows(render()), 0, 'WTH has 10% XIRR, below the fixed 20% high return band');
    filter(render()).props.onChange({ target: { value: 'band:high' } });
    assert.equal(countRows(render()), 1, 'WTH exceeds its debt-fund benchmark high threshold');
    assert.equal(filter(render()).props.value, 'band:high');
    assert.equal(dialog(render()).props.visible, false, 'dropdown filtering does not open a dialog');
    charts(render())[1].props.onClick();
    assert.equal(filter(render()).props.value, 'band:high', 'opening distribution details must preserve a manually selected ranking filter');
    dialog(render()).props.onClose('maskClick');
    filter(render()).props.onChange({ target: { value: 'range:middle' } });
    assert.equal(countRows(render()), 1);
    filter(render()).props.onChange({ target: { value: 'all' } });
    assert.equal(filter(render()).props.value, 'all');
    assert.equal(countRows(render()), 1, 'all ranking products still respects the WTH member scope');
    nodes(render()).find(node => node.type === 'button' && node.props.children === '年化 TWR').props.onClick();
    assert.equal(filter(render()).props.value, 'all', 'changing the metric resets the ranking condition');
    filter(render()).props.onChange({ target: { value: 'range:missing' } });
    assert.equal(countRows(render()), 1, 'TWR missing-rate filtering uses the active metric');
    nodes(render()).find(node => node.type === 'select' && node.props['aria-label'] === '收益分析成员').props.onChange({ target: { value: '全部' } });
    nodes(render()).find(node => node.type === 'button' && node.props.children === 'XIRR').props.onClick();
    filter(render()).props.onChange({ target: { value: 'range:high' } });
    const comparison = tree => nodes(tree).find(node => node.type === 'tr' && node.props.className === 'mr-return-comparison-row');
    comparison(render()).props.onClick();
    modal = dialog(render());
    assert.ok(modal.props.title.includes('分组比较'));
    assert.ok(text(modal).includes('15.00%'));
    const section = label => nodes(modal).find(node => node.type === 'section' && node.props['aria-label'] === label);
    assert.ok(text(section('低于中位数')).includes('WTH 示例产品'));
    assert.ok(!text(section('低于中位数')).includes('Assets 示例产品'));
    assert.ok(text(section('高于中位数')).includes('Assets 示例产品'));
    assert.equal(filter(render()).props.value, 'range:high');
    const medianTable = nodes(modal).find(node => node.props?.className === 'mr-return-median-groups');
    const beforeMedianClose = { ...counters };
    modal.props.onClose('maskClick');
    modal = dialog(render());
    assert.deepEqual(counters, beforeMedianClose);
    assert.equal(nodes(modal).find(node => node.props?.className === 'mr-return-median-groups'), medianTable);
    let prevented = false;
    comparison(render()).props.onKeyDown({ key: 'Enter', preventDefault: () => { prevented = true; } });
    assert.equal(prevented, true);
    assert.equal(dialog(render()).props.visible, true);
    assert.deepEqual(counters, beforeMedianClose);

  } finally {
    Object.assign(React, original);
    Object.assign(analysis, functions);
    if (extension) require.extensions['.tsx'] = extension; else delete require.extensions['.tsx'];
  }
});

test('distribution classifies each product once even with multiple benchmark buckets', () => {
  const { distribution, BENCHMARK_BUCKETS } = require('../src/pages/MonthlyReview/return-analysis.ts');
  const rows = Array.from({ length: 2000 }, (_, i) => ({ id: String(i), balanceRmb: 0.1, bucket: BENCHMARK_BUCKETS[i % BENCHMARK_BUCKETS.length] }));
  let classifications = 0;
  const groups = distribution(rows, BENCHMARK_BUCKETS, row => { classifications++; return row.bucket; });
  assert.equal(classifications, rows.length);
  assert.equal(groups.reduce((sum, group) => sum + group.count, 0), rows.length);
  assert.equal(groups.find(group => group.key === 'high').balanceRmb, 33.4);
});

test('liquidity maturity groups use the supplied analysis date and calendar boundaries across years and leap years', () => {
  const { liquidityBounds, maturityBucket, maturitySerial } = require('../src/pages/MonthlyReview/liquidity-analysis.ts');
  const bounds = liquidityBounds(serialDate('2026-11-08'));
  assert.equal(bounds.monthEnd, serialDate('2026-11-30'));
  assert.equal(bounds.threeMonthEnd, serialDate('2027-02-28'));
  for (const [date, expected] of [
    ['2026-11-07', 'matured'], ['2026-11-08', 'matured'],
    ['2026-11-09', 'thisMonth'], ['2026-11-30', 'thisMonth'],
    ['2026-12-01', 'nextThreeMonths'], ['2027-02-28', 'nextThreeMonths'], ['2027-03-01', 'later'],
  ]) assert.equal(maturityBucket(serialDate(date), bounds), expected);
  assert.equal(maturityBucket('2026/11/30', bounds), 'thisMonth');
  for (const value of [null, 0, '', '  ']) assert.equal(maturityBucket(value, bounds), 'undated');
  for (const value of ['Restricted', '2026-02-30', -1, NaN, Infinity, false]) assert.equal(maturityBucket(value, bounds), 'unknown');
  assert.equal(maturityBucket('2026-11-30', null), 'unknown');
  assert.equal(liquidityBounds(null), null);
  assert.equal(maturitySerial('2028-02-29'), serialDate('2028-02-29'));
  assert.equal(maturitySerial('2027-02-29'), null);
  const leap = liquidityBounds(serialDate('2027-11-30'));
  assert.equal(leap.threeMonthEnd, serialDate('2028-02-29'));
  assert.equal(maturityBucket('2028-02-29', leap), 'nextThreeMonths');
});

test('liquidity profitability filtering preserves zero and unknown gains and composes with member and holding scopes', async () => {
  const { liquidityRows, selectLiquidityRows, DEFAULT_LIQUIDITY_FILTERS, profitStatus, liquidityGroups, liquiditySummary } = require('../src/pages/MonthlyReview/liquidity-analysis.ts');
  const book = await fixture();
  book.set('Assets', 'L1', serialDate('2026-11-08'));
  book.set('Assets', 'G3', serialDate('2026-11-20'));
  for (const p of book.products()) book.saveTransactions(p, [{ date: '2026-10-01', amount: p.sheet === 'WTH' ? 1100 : 1000, shares: 100, price: 10, kind: 'buy' }]);
  const products = book.products(), before = book.cell('Assets', 'E3');
  const rows = liquidityRows(book, products, [], '2026-11-08');
  assert.deepEqual(rows.map(row => row.profit), ['profitable', 'unprofitable']);
  assert.deepEqual(rows.map(row => row.bucket), ['thisMonth', 'undated']);
  assert.equal(selectLiquidityRows(rows, { ...DEFAULT_LIQUIDITY_FILTERS, profit: 'profitable' }).length, 1);
  assert.equal(selectLiquidityRows(rows, { ...DEFAULT_LIQUIDITY_FILTERS, profit: 'unprofitable', member: 'WTH', currency: 'RMB', category: 'Debt Fund' }).length, 1);
  assert.equal(selectLiquidityRows(rows, { ...DEFAULT_LIQUIDITY_FILTERS, profit: 'profitable', member: 'WTH' }).length, 0);
  assert.equal(profitStatus(0), 'unprofitable');
  assert.equal(profitStatus(-1), 'unprofitable');
  for (const value of [null, '', 'N/A', NaN, Infinity]) assert.equal(profitStatus(value), 'unknown');
  const invalid = liquidityRows(book, products, [productKey(products[0])]);
  assert.equal(invalid[0].profit, 'unknown');
  assert.equal(invalid[0].balanceRmb, null);
  const closed = [{ ...rows[0], product: { ...rows[0].product, balance: 0 } }];
  assert.equal(selectLiquidityRows(closed, DEFAULT_LIQUIDITY_FILTERS).length, 0);
  assert.equal(selectLiquidityRows(closed, { ...DEFAULT_LIQUIDITY_FILTERS, holdingOnly: false }).length, 1);
  const groups = liquidityGroups(rows), summary = liquiditySummary(rows);
  assert.deepEqual(groups.slice(0, 2).map(group => group.key), ['undated', 'matured']);
  assert.equal(groups.reduce((total, group) => total + group.count, 0), rows.length);
  assert.equal(groups.find(group => group.key === 'thisMonth').balanceRmb, 1100);
  assert.equal(summary.balanceRmb, 2200);
  assert.equal(summary.throughMonth, 1100);
  assert.equal(summary.availableNow, 1100);
  assert.equal(summary.unconfirmed, null);
  assert.equal(summary.profitable, 1);
  assert.equal(summary.unprofitable, 1);
  assert.deepEqual(book.cell('Assets', 'E3'), before);
  const foreign = liquidityRows(book, [{ ...products[0], currency: 'USD', balance: 0.1 }, { ...products[1], currency: 'MISSING' }]);
  assert.equal(foreign[0].balanceRmb, 0.7);
  assert.equal(foreign[1].balanceRmb, null);
  assert.equal(liquiditySummary(foreign).missingBalance, 1);
});

test('liquidity details respect profit filtering and sort dates while keeping undated products separate', async () => {
  const { liquidityRows, selectLiquidityRows, liquidityDetails, DEFAULT_LIQUIDITY_FILTERS } = require('../src/pages/MonthlyReview/liquidity-analysis.ts');
  const book = await fixture();
  book.set('Assets', 'G3', '2026-11-20'); book.set('WTH', 'G3', 'not a date');
  book.saveTransactions(book.products()[0], [{ date: '2026-10-01', amount: 1000, shares: 100, price: 10, kind: 'buy' }]);
  const rows = liquidityRows(book, book.products());
  assert.equal(rows[0].date, '2026-11-20');
  assert.equal(rows[1].bucket, 'unknown');
  const unknown = selectLiquidityRows(rows, { ...DEFAULT_LIQUIDITY_FILTERS, profit: 'unknown' });
  assert.equal(liquidityDetails(unknown, 'unknown').length, 1);
  assert.equal(liquidityDetails(unknown, 'thisMonth').length, 0);
  assert.deepEqual(liquidityDetails([...rows].reverse(), 'all').map(row => row.id), rows.map(row => row.id));
  assert.equal(rows.length, 2);
});

test('liquidity profit filters drive scoped popup details and closing reuses data and table cache', async () => {
  const book = await fixture();
  book.set('Assets', 'L1', serialDate('2026-11-08'));
  book.set('Assets', 'G3', serialDate('2026-11-20'));
  for (const p of book.products()) book.saveTransactions(p, [{ date: '2026-10-01', amount: p.sheet === 'WTH' ? 1200 : 1000, shares: 100, price: 10, kind: 'buy' }]);
  const products = book.products(), React = require('react'), { renderToStaticMarkup } = require('react-dom/server');
  const original = { useState: React.useState, useMemo: React.useMemo, useEffect: React.useEffect };
  const extension = require.extensions['.tsx'];
  require.extensions['.tsx'] = (m, f) => m._compile(ts.transpileModule(fs.readFileSync(f, 'utf8'), { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2020, jsx: ts.JsxEmit.React, esModuleInterop: true } }).outputText, f);
  const value = book.value.bind(book);
  let reads = 0, states = [], memos = [], cursor = 0;
  try {
    const Component = require('../src/pages/MonthlyReview/LiquidityAnalysis.tsx').default;
    const props = { book, products, invalidKeys: [], templateSummary: [0, 100, 0, 0, 2100], categoryNames: {}, onViewProduct: () => {} };
    const html = renderToStaticMarkup(React.createElement(Component, props));
    for (const text of ['流动性分析', '流动性获利筛选', '已获利', '未获利', '模板原有流动性汇总']) assert.ok(html.includes(text));
    const empty = renderToStaticMarkup(React.createElement(Component, { ...props, products: [] }));
    assert.ok(empty.includes('没有符合当前筛选条件的产品'));
    assert.ok(!empty.includes('NaN'));
    React.useState = initial => {
      const index = cursor++;
      if (!(index in states)) states[index] = typeof initial === 'function' ? initial() : initial;
      return [states[index], next => { states[index] = typeof next === 'function' ? next(states[index]) : next; }];
    };
    React.useMemo = (fn, deps) => {
      const index = cursor++, previous = memos[index];
      if (!previous || deps.length !== previous.deps.length || deps.some((item, i) => !Object.is(item, previous.deps[i]))) memos[index] = { deps: [...deps], value: fn() };
      return memos[index].value;
    };
    React.useEffect = () => {};
    book.value = (...args) => { reads++; return value(...args); };
    const nodes = node => !node || typeof node !== 'object' ? [] : Array.isArray(node) ? node.flatMap(nodes) : [node, ...nodes(node.props?.children)];
    const text = node => Array.isArray(node) ? node.map(text).join('') : node && typeof node === 'object' ? text(node.props?.children) : node == null || node === false ? '' : String(node);
    const render = () => { cursor = 0; return Component(props); };
    const modal = tree => nodes(tree).find(node => node.props?.className?.includes('mr-liquidity-details'));
    const profit = tree => nodes(tree).find(node => node.type === 'select' && node.props['aria-label'] === '流动性获利筛选');
    const openAll = tree => nodes(tree).find(node => node.type === 'button' && node.props.children === '查看产品明细').props.onClick();
    profit(render()).props.onChange({ target: { value: 'profitable' } });
    openAll(render());
    let dialog = modal(render());
    assert.equal(dialog.props.visible, true);
    assert.equal(nodes(dialog).find(node => node.type === 'tbody').props.children.length, 1);
    assert.ok(text(dialog).includes('Assets 示例产品'));
    assert.ok(text(dialog).includes('2026-11-20'));
    const before = reads, table = nodes(dialog).find(node => node.type === 'div' && node.props.className === 'mr-table-wrap');
    dialog.props.onClose('maskClick');
    dialog = modal(render());
    assert.equal(dialog.props.visible, false);
    assert.equal(reads, before);
    assert.equal(nodes(dialog).find(node => node.type === 'div' && node.props.className === 'mr-table-wrap'), table);
    profit(render()).props.onChange({ target: { value: 'unprofitable' } });
    openAll(render());
    dialog = modal(render());
    assert.equal(nodes(dialog).find(node => node.type === 'tbody').props.children.length, 1);
    assert.ok(text(dialog).includes('WTH 示例产品'));
    assert.ok(text(dialog).includes('-100.00'));
  } finally {
    Object.assign(React, original);
    book.value = value;
    if (extension) require.extensions['.tsx'] = extension; else delete require.extensions['.tsx'];
  }
});


test('liquidity uses XIRR total cost rather than period gain, with deposit exceptions and unknown costs', async () => {
  const { liquidityRows, liquidityCost } = require('../src/pages/MonthlyReview/liquidity-analysis.ts');
  const book = await fixture();
  for (const p of book.products()) book.saveTransactions(p, [{ date: '2026-10-01', amount: p.sheet === 'WTH' ? 1200 : 1000, shares: 100, price: 10, kind: 'buy' }]);
  book.set('Assets', 'J3', -999); book.set('WTH', 'J3', 999);
  const products = book.products();
  let rows = liquidityRows(book, products);
  assert.deepEqual(rows.map(r => [r.cost, r.gain, r.profit]), [[1000, 100, 'profitable'], [1200, -100, 'unprofitable']]);
  const block = products[0].block;
  book.set(block.sheet, 'I' + block.summary, -50);
  assert.equal(liquidityRows(book, products)[0].gain, 1150);
  book.set(block.sheet, 'I' + block.summary, 'N/A');
  assert.equal(liquidityRows(book, products)[0].profit, 'unknown');
  for (const category of ['Current Account', '活期存款', 'Time Deposit', '定期存款']) {
    const row = liquidityRows(book, [{ ...products[0], category, block: undefined }])[0];
    assert.equal(row.profit, 'profitable'); assert.equal(row.gain, null);
  }
  book.set(block.sheet, 'E' + block.start, 1000);
  book.set(block.sheet, 'E' + (block.start + 1), -200);
  book.set(block.sheet, 'E' + (block.start + 2), -25);
  const shared = { ...products[0], block: { ...block, shared: true, sourceRows: [block.start, block.start + 1, block.start + 2] } };
  assert.equal(liquidityCost(book, shared), 775);
  assert.equal(liquidityRows(book, [shared])[0].gain, 325);
  book.set(block.sheet, 'E' + (block.start + 2), 'N/A');
  assert.equal(liquidityCost(book, shared), null);
  assert.equal(liquidityCost(book, { ...shared, block: { ...shared.block, sourceRows: [] } }), null);
});


test('liquidity maturity uses local today independently of workbook accounting dates', async () => {
  const { liquidityRows, liquidityToday, liquidityBounds } = require('../src/pages/MonthlyReview/liquidity-analysis.ts');
  const book = await fixture();
  book.set('Assets', 'L1', serialDate('2026-10-01'));
  book.set('Assets', 'G3', serialDate('2026-11-08'));
  const products = book.products();
  assert.equal(liquidityRows(book, products, [], '2026-11-07')[0].bucket, 'thisMonth');
  assert.equal(liquidityRows(book, products, [], '2026-11-08')[0].bucket, 'matured');
  assert.equal(liquidityRows(book, products, [], '2026-11-09')[0].days, -1);
  assert.equal(liquidityToday(new Date(2026, 10, 8, 23, 59)), '2026-11-08');
  const today = liquidityToday();
  book.set('Assets', 'L1', 'invalid accounting date');
  book.set('Assets', 'G3', serialDate(today));
  const row = liquidityRows(book, products)[0];
  assert.equal(row.bucket, 'matured'); assert.equal(row.days, 0);
  assert.equal(liquidityBounds().asOf, serialDate(today));
});

test('monthly dialogs use CSS positioning from first paint and preserve cached mask closing', () => {
  const extension = require.extensions['.tsx'];
  require.extensions['.tsx'] = (m, f) => m._compile(ts.transpileModule(fs.readFileSync(f, 'utf8'), { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2020, jsx: ts.JsxEmit.React, esModuleInterop: true } }).outputText, f);
  try {
    const MonthlyDialog = require('../src/pages/MonthlyReview/MonthlyDialog.tsx').default;
    const DialogImpl = require('@alifd/next/lib/dialog/dialog').default;
    const OverlayImpl = require('@alifd/next/lib/overlay/overlay').default;
    let closed = 0;
    const element = MonthlyDialog({ visible: true, title: '产品明细', className: 'mr-dialog', closeMode: ['close', 'mask', 'esc'], overlayProps: { cache: true, wrapperClassName: 'custom-overlay' }, onClose: () => { closed++; } });
    assert.equal(element.props.animation, false);
    assert.equal(element.props.overlayProps.cache, true);
    assert.equal(element.props.overlayProps.wrapperClassName, 'mr-dialog-overlay custom-overlay');
    const impl = new DialogImpl({ ...DialogImpl.defaultProps, ...element.props });
    const overlay = impl.render();
    assert.equal(overlay.props.align, false); // No JS measurement or repositioning.
    assert.equal(overlay.props.onPosition, undefined);
    assert.equal(overlay.props.isChildrenInMask, true);
    assert.equal(overlay.props.canCloseByEsc, true);
    const mask = {}, content = {};
    OverlayImpl.prototype.handleMaskClick.call({ props: overlay.props }, { target: content, currentTarget: mask });
    assert.equal(closed, 0);
    OverlayImpl.prototype.handleMaskClick.call({ props: overlay.props }, { target: mask, currentTarget: mask });
    assert.equal(closed, 1);
  } finally {
    if (extension) require.extensions['.tsx'] = extension; else delete require.extensions['.tsx'];
  }
});


test('comparison details partition every scoped product at its group median for either return metric', () => {
  const { splitReturnsAtMedian, returnDetailRows, compareReturns } = require('../src/pages/MonthlyReview/return-analysis.ts');
  const row = (id, xirr, twr, member = '本人') => ({ id, product: { name: id, member, currency: 'RMB', category: 'Stock' }, xirr, twr, balanceRmb: 100 });
  const rows = [row('a', -0.1, 0), row('b', 0, 0.2), row('c', 0, 0.4), row('d', 0.2, null), row('e', null, -0.1), row('other', 9, 9, 'WTH')];
  const scoped = returnDetailRows(rows, {}, { kind: 'comparison', dimension: 'member', key: '本人', metric: 'xirr' });
  const result = splitReturnsAtMedian(scoped, 'xirr');
  assert.equal(result.median, 0);
  assert.deepEqual(result.groups.map(g => g.rows.map(r => r.id)), [['a'], ['b', 'c'], ['d'], ['e']]);
  assert.equal(compareReturns(scoped, 'xirr', 'member')[0].median, result.median);
  const twr = splitReturnsAtMedian(scoped, 'twr');
  assert.equal(twr.median, 0.1);
  assert.deepEqual(twr.groups.map(g => g.rows.map(r => r.id)), [['e', 'a'], [], ['b', 'c'], ['d']]);
  assert.equal(splitReturnsAtMedian(scoped.slice(0, 3), 'twr').median, 0.2);
  const missing = splitReturnsAtMedian([row('missing', null, null)], 'xirr');
  assert.equal(missing.median, null);
  assert.deepEqual(missing.groups.map(g => g.rows.length), [0, 0, 0, 1]);
  assert.equal(splitReturnsAtMedian([], 'xirr').median, null);
  for (const [dimension, key] of [['category', 'Stock'], ['currency', 'RMB']]) assert.equal(returnDetailRows(rows, {}, { kind: 'comparison', dimension, key, metric: 'xirr' }).length, rows.length);
  assert.deepEqual(rows.map(r => r.id), ['a', 'b', 'c', 'd', 'e', 'other']);
});
