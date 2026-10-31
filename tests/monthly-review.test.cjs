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
test('reference workbook calculations match all cached Excel results', { skip: !template }, async () => {
  const b = await MonthlyWorkbook.open(fs.readFileSync(template)); let checked = 0;
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
