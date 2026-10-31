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
  let b = await fixture(); const groups = productGroups(b.products()); assert.equal(groups.length, 2);
  assert.ok(groups.every(g => !('name' in g) && !('account' in g)));
  const group = groups.find(g => g.sheet === 'Assets');
  const p = createProductEntry(b, group.key, { name: '  新产品  ', account: '  新账户  ', balance: 1100, flow: 1000, previous: 999, due: '', note: '' }, 'manual');
  assert.equal(p.name, '新产品'); assert.equal(p.account, '新账户'); assert.equal(p.previous, 0); assert.equal(p.flow, 1000); assert.equal(p.category, group.category);
  assert.equal(b.number(p.sheet, `J${p.row}`), 100); assert.equal(b.transactions(p.block).length, 0);
  assert.equal(productGroups(b.products()).length, 2);
  b = await MonthlyWorkbook.open(await b.export()); assert.ok(b.products().some(x => x.account === '新账户' && x.previous === 0 && x.flow === 1000));
});
test('a new product can record multiple purchases, sales and distributions across a multi-month accounting period', async () => {
  let b = await fixture(); b.set('Assets', 'N1', serialDate('2026-07-05')); b.set('Assets', 'L1', serialDate('2026-10-11'));
  const group = productGroups(b.products()).find(g => g.sheet === 'Assets');
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
  const b = await fixture(), group = productGroups(b.products())[0], before = b.products().length;
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
  const b = await fixture(), group = productGroups(b.products()).find(g => g.sheet === 'Assets');
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
  const rows = [{ ...a, name: '产品10', balance: 9 }, { ...b, name: '产品2', balance: 1000 }];
  assert.equal(sortedProducts(rows, book, { field: 'name', direction: 'asc' })[0].name, '产品2');
  assert.equal(sortedProducts(rows, book, { field: 'balance', direction: 'asc' })[0].balance, 9);
  assert.equal(sortedProducts(rows, book, { field: 'balance', direction: 'desc' })[0].balance, 1000);
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
});

const { isCashAccount } = require('../src/pages/MonthlyReview/categories.ts');
test('cash accounts merge legacy categories and enforce formula net flows across edits, transactions, rollover and export', async () => {
  let book = await fixture(); book.set('Assets', 'B3', 'Current Account'); book.set('WTH', 'B3', 'Monetary Fund'); book.applyCashAccountRules();
  assert.equal(book.products().filter(p => p.category === 'Current Account').length, 2);
  assert.ok(productGroups(book.products()).every(g => g.category === 'Current Account'));
  assert.equal(productGroups([book.products()[0], { ...book.products()[0], category:'Monetary Fund' }]).length, 1);
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
  const anchor = book.products()[0], group = productGroups(book.products()).find(g => isCashAccount(g.category));
  const p = createProductEntry(book, group.key, {name:'新活期账户',account:'新账户',balance:200.25,flow:NaN,due:'',note:''},'transactions',[]);
  assert.equal(p.flow,200.25); assert.equal(p.previous,0); assert.equal(p.sourceCategory,'Monetary Fund');
  assert.equal(book.cell(p.sheet, `I${p.row}`).formula, `E${p.row}-H${p.row}`);
  book.deleteProduct(p); assert.equal(book.products()[0].name,anchor.name); assert.equal(book.products()[0].sourceCategory,'Monetary Fund');
  assert.equal(book.products()[1].category,'Debt Fund');
});
