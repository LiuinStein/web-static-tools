const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const ts = require('typescript');
// Load the feature's TypeScript directly without changing the app's toolchain.
require.extensions['.ts'] = (module, filename) => {
  const result = ts.transpileModule(fs.readFileSync(filename, 'utf8'), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2020, esModuleInterop: true },
  });
  module._compile(result.outputText, filename);
};
const { calculateFee, mergeTrades, validateTrade, applyChanges, queueChange, mergeForSync, visibleTrades } = require('../src/pages/TradingJournal/model.ts');
const { readWorkbook, writeWorkbook } = require('../src/pages/TradingJournal/workbook.ts');
const { OneDriveJournal, normalizePath } = require('../src/pages/TradingJournal/onedrive.ts');
function trade(id = 'trade-1') {
  return { id, date: '2026-10-29', type: '债券基金', code: '005827', name: '示例基金', stance: '看多', direction: '买入', amount: 1001.5, price: 1, shares: 1000, fee: 1.5, reason: '第一行\n第二行，记录完整交易逻辑。' };
}
test('stock fees use total minus price times shares, preserving signed difference', () => {
  assert.equal(calculateFee(10005, 100, 100), 5);
  assert.equal(calculateFee(9995, 100, 100), -5);
  assert.equal(calculateFee(10.13, 0.1, 100), 0.13);
});
test('Excel roundtrip preserves leading-zero codes, multiline reasons, optional shares and other sheets', async () => {
  const { workbook } = await readWorkbook();
  workbook.addWorksheet('说明').addRow(['请保留此表']);
  const first = trade();
  const second = { ...trade('trade-2'), shares: undefined, fee: 0 };
  const data = await writeWorkbook(workbook, [first, second]);
  const result = await readWorkbook(data);
  assert.deepEqual(result.trades, [first, second]);
  assert.equal(result.workbook.getWorksheet('说明').getCell('A1').text, '请保留此表');
  assert.equal(result.workbook.getWorksheet('交易记录').getCell('D1').text, '代码');
});
test('foreign workbook and malformed rows are rejected before overwriting', async () => {
  const { workbook } = await readWorkbook();
  workbook.getWorksheet('交易记录').getCell('A1').value = '其他数据';
  await assert.rejects(readWorkbook(await workbook.xlsx.writeBuffer()), /表头不匹配/);
  assert.throws(() => validateTrade({ ...trade(), date: '2026-02-30' }), /日期/);
  assert.throws(() => validateTrade({ ...trade(), amount: NaN }), /金额/);
});
test('merge is idempotent and rejects conflicting duplicate IDs', () => {
  assert.equal(mergeTrades([trade()], [trade()]).length, 1);
  assert.throws(() => mergeTrades([trade()], [{ ...trade(), amount: 88 }]), /ID/);
});
test('target paths reject traversal and non-xlsx files', () => {
  assert.equal(normalizePath('/交易日记/交易日记.xlsx/'), '交易日记/交易日记.xlsx');
  assert.throws(() => normalizePath('../private.xlsx'));
  assert.throws(() => normalizePath('journal.csv'));
});
test('OneDrive retries a version conflict, merges another device record and sends If-Match', async () => {
  const service = Object.create(OneDriveJournal.prototype);
  let loads = 0;
  service.load = async () => {
    loads += 1;
    const { workbook } = await readWorkbook();
    const trades = loads === 1 ? [] : [trade('remote-device')];
    await writeWorkbook(workbook, trades);
    return { workbook, trades, item: { id: 'file-id', eTag: `version-${loads}` } };
  };
  const headers = [];
  let uploaded;
  service.client = { api: () => {
    const request = {
      header(name, value) { if (name === 'If-Match') headers.push(value); return request; },
      async put(data) {
        assert.ok(data instanceof Blob);
        assert.equal(data.type, 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
        data = await data.arrayBuffer();
        if (loads === 1) throw { statusCode: 412 };
        uploaded = (await readWorkbook(data)).trades;
      },
    };
    return request;
  } };
  const result = await service.sync([trade('local-device')]);
  assert.deepEqual(headers, ['version-1', 'version-2']);
  assert.equal(result.length, 2);
  assert.equal(uploaded.length, 2);
});
test('OneDrive upload failure is surfaced, never reported as success', async () => {
  const service = Object.create(OneDriveJournal.prototype);
  service.load = async () => ({ ...await readWorkbook(), item: { id: 'id', eTag: 'v1' } });
  service.client = { api: () => {
    const request = { header() { return request; }, async put() { throw { statusCode: 403, message: 'Access denied' }; } };
    return request;
  } };
  await assert.rejects(service.sync([trade()]), error => error.statusCode === 403);
});

test('editing and deleting Excel rows updates the original record, including deleting the last row', async () => {
  const { workbook } = await readWorkbook();
  workbook.addWorksheet('说明').addRow(['保留其他工作表']);
  await writeWorkbook(workbook, [trade('first'), trade('second')]);
  const edited = { ...trade('first'), amount: 2005, fee: 5, reason: '修改后的原因\n保留完整文本' };
  let result = await readWorkbook(await writeWorkbook(workbook, [edited]));
  assert.deepEqual(result.trades, [edited]);
  assert.equal(result.workbook.getWorksheet('说明').getCell('A1').text, '保留其他工作表');
  result = await readWorkbook(await writeWorkbook(result.workbook, []));
  assert.equal(result.trades.length, 0);
  assert.equal(result.workbook.getWorksheet('交易记录').rowCount, 1);
});
test('queued edits coalesce without changing the original ID or conflict baseline', () => {
  const original = trade();
  const first = { ...original, name: '修订名称', amount: 1200 };
  const second = { ...first, reason: '再次编辑' };
  const changes = queueChange([original], [], [], original, first);
  const next = queueChange([original], [], changes, first, second);
  assert.equal(next.length, 1);
  assert.deepEqual(next[0].before, original);
  assert.notEqual(next[0].operationId, changes[0].operationId);
  assert.deepEqual(applyChanges([original], next), [second]);
  const removed = queueChange([original], [], next, second);
  assert.deepEqual(applyChanges([original], removed), []);
});
test('pending creates can be edited/deleted offline and replayed without duplicates', () => {
  const original = trade();
  const edited = { ...original, amount: 2222 };
  const changes = queueChange([], [original], [], original, edited);
  assert.deepEqual(visibleTrades([], [original], changes), [edited]);
  assert.deepEqual(mergeForSync([], [original], changes), [edited]);
  assert.deepEqual(mergeForSync([edited], [original], changes), [edited]);
  const removed = queueChange([], [original], changes, edited);
  assert.deepEqual(mergeForSync([], [original], removed), []);
  assert.deepEqual(mergeForSync([], [], removed), []);
});
test('concurrent edit/delete conflicts do not overwrite remote data and local work stays visible', () => {
  const original = trade();
  const local = { ...original, reason: '本机修改' };
  const otherDevice = { ...original, reason: '其他设备修改' };
  const changes = queueChange([original], [], [], original, local);
  assert.throws(() => applyChanges([otherDevice], changes), /其他设备/);
  assert.throws(() => applyChanges([], changes), /其他设备/);
  assert.deepEqual(visibleTrades([otherDevice], [], changes), [local]);
  const deletion = queueChange([original], [], [], original);
  assert.throws(() => applyChanges([otherDevice], deletion), /其他设备/);
  assert.throws(() => queueChange([otherDevice], [], [], original, local), /发生变化/);
});
test('OneDrive edit/delete sync preserves unrelated remote rows and retries upload responses idempotently', async () => {
  const original = trade();
  const edited = { ...original, amount: 3001.5, shares: 3000 };
  const deletionTarget = trade('remove-me');
  const other = trade('other-device');
  const edits = queueChange([original, deletionTarget], [], [], original, edited);
  const changes = queueChange([original, deletionTarget], [], edits, deletionTarget);
  const service = Object.create(OneDriveJournal.prototype);
  let remote = [original, deletionTarget, other];
  let writes = 0;
  service.load = async () => {
    const { workbook } = await readWorkbook();
    await writeWorkbook(workbook, remote);
    return { workbook, trades: remote, item: { id: 'file', eTag: `v${writes}` } };
  };
  service.client = { api: () => {
    const request = { header() { return request; }, async put(data) {
        assert.ok(data instanceof Blob);
        assert.equal(data.type, 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
        data = await data.arrayBuffer();
      remote = (await readWorkbook(data)).trades;
      writes += 1;
    } };
    return request;
  } };
  await service.sync([], changes);
  assert.deepEqual(new Set(remote.map(item => item.id)), new Set([original.id, other.id]));
  assert.equal(remote.find(item => item.id === original.id).amount, 3001.5);
  await service.sync([], changes);
  assert.equal(remote.length, 2);
  assert.equal(remote.find(item => item.id === original.id).amount, 3001.5);
});

const { SyncQueue, completeSync } = require('../src/pages/TradingJournal/sync-queue.ts');
test('background upload preserves new local records and serializes the next upload', async () => {
  const states = [];
  const queue = new SyncQueue(value => states.push(value));
  const first = trade('first');
  const second = trade('second');
  let cache = { remote: [], pending: [first], changes: [] };
  let release;
  const gate = new Promise(resolve => { release = resolve; });
  let secondStarted = false;
  const background = queue.run(async () => {
    const sent = cache;
    await gate;
    cache = completeSync(cache, sent, [first]);
  });
  await Promise.resolve();
  // Saving locally is possible while the cloud request is still in flight.
  cache = { ...cache, pending: [...cache.pending, second] };
  const foreground = queue.run(async () => {
    secondStarted = true;
    assert.deepEqual(cache.remote, [first]);
    assert.deepEqual(cache.pending, [second]);
    const sent = cache;
    cache = completeSync(cache, sent, mergeForSync(cache.remote, cache.pending, cache.changes));
  });
  assert.equal(secondStarted, false);
  assert.equal(queue.busy, true);
  release();
  await Promise.all([background, foreground]);
  assert.deepEqual(cache.remote.map(row => row.id), ['first', 'second']);
  assert.deepEqual(cache.pending, []);
  assert.equal(queue.busy, false);
  assert.deepEqual(states, [true, false]);
});
test('editing or deleting during an earlier upload rebases only the uploaded local operation', () => {
  const original = trade();
  const first = { ...original, amount: 2000 };
  const second = { ...first, reason: 'Edited while upload is pending' };
  const sent = { remote: [original], pending: [], changes: queueChange([original], [], [], original, first) };
  for (const after of [second, undefined]) {
    const latest = { ...sent, changes: queueChange(sent.remote, [], sent.changes, first, after) };
    const next = completeSync(latest, sent, [first]);
    assert.deepEqual(next.changes[0].before, first);
    assert.deepEqual(mergeForSync(next.remote, next.pending, next.changes), after ? [second] : []);
    const otherDevice = { ...first, reason: 'Remote concurrent edit' };
    assert.throws(() => mergeForSync([otherDevice], next.pending, next.changes), /其他设备/);
  }
});
test('a rejected background request does not stall later uploads or leave the queue busy', async () => {
  const states = [];
  const queue = new SyncQueue(value => states.push(value));
  const failed = queue.run(async () => { throw new Error('offline'); });
  const next = queue.run(async () => 'retried');
  await assert.rejects(failed, /offline/);
  assert.equal(await next, 'retried');
  assert.equal(queue.busy, false);
  assert.deepEqual(states, [true, false]);
});
test('automatic sync never opens an authorization popup and restores manual authorization after failure', async () => {
  const service = Object.create(OneDriveJournal.prototype);
  let popups = 0;
  service.account = { homeAccountId: 'account-a' };
  service.session = {
    currentAccount() { return service.account; },
    async token(id, interactive) {
      assert.equal(id, 'account-a');
      if (!interactive) throw new Error('Microsoft 登录已过期');
      popups += 1; return 'test-token';
    },
  };
  service.syncWorkbook = async () => {
    await service.accessToken();
    return [];
  };
  await assert.rejects(service.sync([], [], false), /登录已过期/);
  assert.equal(popups, 0);
  assert.deepEqual(await service.sync([], [], true), []);
  assert.equal(popups, 1);
});

async function versionedOneDrive() {
  const service = Object.create(OneDriveJournal.prototype);
  service.config = { path: '文档/BalanceSheet/TradingJournal.xlsx' };
  const state = {
    item: { id: 'file', eTag: 'v1', size: 1024 },
    trades: [trade()], metadata: 0, downloads: 0, uploads: 0,
    failUpload: false, omitSavedVersion: false, headers: [],
  };
  const { workbook } = await readWorkbook();
  workbook.addWorksheet('说明').addRow(['Preserve this sheet']);
  state.data = await writeWorkbook(workbook, state.trades);
  service.client = { api(endpoint) {
    const request = {
      select() { return request; },
      responseType() { return request; },
      header(name, value) { if (name === 'If-Match') state.headers.push(value); return request; },
      async get() {
        if (!state.item) throw { statusCode: 404 };
        if (endpoint.endsWith('/content')) {
          state.downloads += 1;
          return state.data;
        }
        state.metadata += 1;
        return { ...state.item };
      },
      async put(data) {
        assert.ok(data instanceof Blob);
        assert.equal(data.type, 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
        data = await data.arrayBuffer();
        state.uploads += 1;
        if (state.failUpload) throw { statusCode: 403, message: 'Upload denied' };
        const result = await readWorkbook(data);
        assert.equal(result.workbook.getWorksheet('说明').getCell('A1').text, 'Preserve this sheet');
        state.data = data;
        state.trades = result.trades;
        state.item = { ...state.item, eTag: `saved-${state.uploads}` };
        return state.omitSavedVersion ? undefined : { ...state.item };
      },
    };
    return request;
  } };
  return { service, state };
}
test('unchanged idle sync checks metadata once and does not download or expose mutable cached records', async () => {
  const { service, state } = await versionedOneDrive();
  const first = await service.read();
  assert.equal(state.downloads, 1);
  first[0].name = 'Changed by caller';
  const before = state.metadata;
  assert.deepEqual(await service.sync([], [], false), [trade()]);
  assert.equal(state.metadata - before, 1);
  assert.equal(state.downloads, 1);
  assert.equal(state.uploads, 0);
});
test('changed version or file ID reloads cloud records even when there are no pending local changes', async () => {
  const { service, state } = await versionedOneDrive();
  await service.read();
  const otherDevice = trade('other-device');
  const { workbook } = await readWorkbook(state.data);
  state.data = await writeWorkbook(workbook, [trade(), otherDevice]);
  state.item.eTag = 'v2';
  assert.equal((await service.sync([])).length, 2);
  assert.equal(state.downloads, 2);
  state.item.id = 'replacement-file'; // eTag alone is not a cache key.
  await service.sync([]);
  assert.equal(state.downloads, 3);
});
test('local changes always fetch a fresh workbook; successful upload versions avoid the next idle download', async () => {
  const { service, state } = await versionedOneDrive();
  await service.read();
  const extra = trade('local-new');
  assert.equal((await service.sync([extra])).length, 2);
  assert.equal(state.downloads, 2);
  assert.deepEqual(state.headers, ['v1']);
  assert.equal(state.uploads, 1);
  assert.equal((await service.sync([])).length, 2);
  assert.equal(state.downloads, 2);
  const edited = { ...trade(), reason: 'New reason' };
  const changes = queueChange(state.trades, [], [], trade(), edited);
  await service.sync([], changes);
  assert.equal(state.downloads, 3);
  assert.equal(state.trades.find(row => row.id === trade().id).reason, 'New reason');
});
test('deleted/recreated files clear version cache and metadata failures never report cached success', async () => {
  const { service, state } = await versionedOneDrive();
  await service.read();
  const previous = state.item;
  state.item = null;
  assert.deepEqual(await service.sync([]), []);
  state.item = previous;
  await service.sync([]);
  assert.equal(state.downloads, 2);
  service.client = { api() { return { select() { return this; }, async get() { throw { statusCode: 403 }; } }; } };
  await assert.rejects(service.sync([]), error => error.statusCode === 403);
});
test('failed uploads and successful uploads without version metadata require a fresh verified read', async () => {
  const { service, state } = await versionedOneDrive();
  await service.read();
  state.failUpload = true;
  await assert.rejects(service.sync([trade('new')]), error => error.statusCode === 403);
  assert.equal(state.downloads, 2);
  await service.sync([]);
  assert.equal(state.downloads, 3);
  state.failUpload = false;
  state.omitSavedVersion = true;
  await service.sync([trade('new')]);
  assert.equal(state.downloads, 4);
  assert.equal((await service.sync([])).length, 2);
  assert.equal(state.downloads, 5);
});
test('missing cloud version disables cache reuse and prevents unprotected uploads', async () => {
  const { service, state } = await versionedOneDrive();
  delete state.item.eTag;
  await service.read();
  await service.sync([]);
  assert.equal(state.downloads, 2);
  await assert.rejects(service.sync([trade('new')]), /无法读取云端文件版本/);
  assert.equal(state.uploads, 0);
});

test('fund unit price is optional; stocks require it and supplied prices must be positive', () => {
  assert.doesNotThrow(() => validateTrade({ ...trade(), price: undefined }));
  assert.doesNotThrow(() => validateTrade({ ...trade(), type: '美股', price: 1 }));
  assert.throws(() => validateTrade({ ...trade(), type: '美股', price: undefined }), /股票单价必填/);
  for (const type of ['港股', '美股', 'A股', '债券基金', '股票基金']) {
    for (const price of [0, -1, NaN, Infinity, null]) {
      assert.throws(() => validateTrade({ ...trade(), type, price }), /单价/);
    }
  }
});
test('blank fund prices survive Excel export/import and editing; blank stock prices are rejected', async () => {
  const fund = { ...trade(), price: undefined };
  const { workbook } = await readWorkbook();
  await writeWorkbook(workbook, [fund]);
  assert.equal(workbook.getWorksheet('交易记录').getCell('I2').value, null);
  const imported = await readWorkbook(await workbook.xlsx.writeBuffer());
  assert.deepEqual(imported.trades, [fund]);
  const edited = { ...fund, reason: 'Updated fund without unit price' };
  const changes = queueChange(imported.trades, [], [], fund, edited);
  const merged = mergeForSync(imported.trades, [], changes);
  assert.deepEqual((await readWorkbook(await writeWorkbook(imported.workbook, merged))).trades, [edited]);
  imported.workbook.getWorksheet('交易记录').getCell('C2').value = '美股';
  await assert.rejects(readWorkbook(await imported.workbook.xlsx.writeBuffer()), /股票单价必填/);
});


test('both fund categories allow blank prices and roundtrip through Excel unchanged', async () => {
  const categories = require('../src/pages/TradingJournal/model.ts').assetTypes;
  assert.deepEqual(categories, ['港股', '美股', 'A股', '债券基金', '股票基金']);
  const records = [
    { ...trade('bond-fund'), type: '债券基金', price: undefined, shares: undefined },
    { ...trade('equity-fund'), type: '股票基金', price: undefined, shares: 100 },
    { ...trade('stock'), type: '美股', currency: 'USD', price: 10 },
    trade('historical-fund'),
  ];
  records.forEach(row => assert.doesNotThrow(() => validateTrade(row)));
  const { workbook } = await readWorkbook();
  assert.deepEqual((await readWorkbook(await writeWorkbook(workbook, records))).trades, records);
  assert.throws(() => validateTrade({ ...trade(), type: '债券' }), /交易分类/);
});
test('fund records can be explicitly reclassified and synced without changing record IDs', async () => {
  const original = trade('historical-fund');
  for (const type of ['债券基金', '股票基金']) {
    const updated = { ...original, type, price: undefined };
    const changes = queueChange([original], [], [], original, updated);
    const merged = mergeForSync([original], [], changes);
    assert.deepEqual(merged, [updated]);
    assert.deepEqual(mergeForSync(merged, [], changes), [updated]);
    const { workbook } = await readWorkbook();
    assert.deepEqual((await readWorkbook(await writeWorkbook(workbook, merged))).trades, [updated]);
    assert.throws(() => validateTrade({ ...updated, type: '美股' }), /股票单价必填/);
  }
});

const { calculateHoldings } = require('../src/pages/TradingJournal/holdings.ts');
test('holdings net buy/sell amounts and shares, without adding fees twice', () => {
  const bought = { ...trade('buy'), amount: 1000, shares: 100, fee: 20 };
  const sold = { ...trade('sell'), direction: '卖出', amount: 330, shares: 30, fee: -5 };
  const rows = [bought, sold];
  const snapshot = JSON.stringify(rows);
  const [holding] = calculateHoldings(rows);
  assert.equal(holding.totalCost, 670);
  assert.equal(holding.shares, 70);
  assert.equal(holding.averagePrice, 670 / 70);
  assert.equal(JSON.stringify(rows), snapshot);
});
test('holdings group by type and normalized text code, preserve leading zeros and use newest name', () => {
  const rows = [
    { ...trade('old'), name: '旧名称', date: '2026-10-01', amount: 100, shares: 10, type: '债券基金' },
    { ...trade('new'), name: '新名称', date: '2026-10-30', amount: 200, shares: 20, type: '债券基金' },
    { ...trade('equity'), amount: 900, shares: 30, type: '股票基金' },
    { ...trade('stock-a'), code: 'aapl', type: '美股', amount: 100, shares: 1 },
    { ...trade('stock-b'), code: 'AAPL', type: '美股', amount: 200, shares: 1 },
  ];
  const holdings = calculateHoldings(rows);
  assert.equal(holdings.length, 3);
  const bond = holdings.find(row => row.type === '债券基金');
  assert.equal(bond.code, '005827');
  assert.equal(bond.name, '新名称');
  assert.equal(bond.totalCost, 300);
  assert.equal(bond.shares, 30);
  assert.equal(holdings.find(row => row.type === '美股').totalCost, 300);
});
test('closed positions including fractional share residue are hidden; remaining cost may be negative', () => {
  assert.deepEqual(calculateHoldings([
    { ...trade('one'), amount: 10, shares: 0.1 },
    { ...trade('two'), amount: 20, shares: 0.2 },
    { ...trade('three'), direction: '卖出', amount: 40, shares: 0.3 },
  ]), []);
  const [holding] = calculateHoldings([
    { ...trade('buy'), amount: 100, shares: 10 },
    { ...trade('sell'), direction: '卖出', amount: 120, shares: 5 },
  ]);
  assert.equal(holding.totalCost, -20);
  assert.equal(holding.shares, 5);
  assert.equal(holding.averagePrice, -4);
});
test('missing shares leave quantity and average unknown without losing known total cost', () => {
  const [holding] = calculateHoldings([
    { ...trade('buy'), amount: 100, shares: undefined, price: 10 },
    { ...trade('sell'), direction: '卖出', amount: 40, shares: 4 },
  ]);
  assert.equal(holding.totalCost, 60);
  assert.equal(holding.shares, undefined);
  assert.equal(holding.averagePrice, undefined);
  assert.equal(holding.missingShares, 1);
});
test('holdings immediately follow pending creates, edits and deletions and stay out of Excel', async () => {
  const original = { ...trade('old'), amount: 100, shares: 10 };
  const added = { ...trade('new'), amount: 200, shares: 20 };
  const edited = { ...original, amount: 150, shares: 15 };
  let changes = queueChange([original], [added], [], original, edited);
  let visible = visibleTrades([original], [added], changes);
  assert.equal(calculateHoldings(visible)[0].totalCost, 350);
  changes = queueChange([original], [added], changes, added);
  visible = visibleTrades([original], [added], changes);
  assert.equal(calculateHoldings(visible)[0].shares, 15);
  const { workbook } = await readWorkbook();
  const imported = await readWorkbook(await writeWorkbook(workbook, visible));
  assert.deepEqual(imported.workbook.worksheets.map(sheet => sheet.name), ['交易记录']);
  assert.equal(imported.workbook.getWorksheet('交易记录').columnCount, 14);
  assert.deepEqual(imported.trades, [edited]);
  assert.deepEqual(calculateHoldings(imported.trades), calculateHoldings(visible));
  assert.deepEqual(calculateHoldings([]), []);
});

test('stock markets and brainstorm records roundtrip without affecting actual holdings', async () => {
  const { calculateHoldings } = require('../src/pages/TradingJournal/holdings.ts');
  const markets = ['港股', '美股', 'A股'];
  const records = markets.map((type, index) => ({ ...trade(String(index)), type, currency: ['HKD','USD','RMB'][index], brainstorm: true }));
  records.forEach(validateTrade);
  records.forEach(row => assert.throws(() => validateTrade({ ...row, price: undefined }), /股票单价必填/));
  const { workbook } = await readWorkbook();
  const result = await readWorkbook(await writeWorkbook(workbook, records));
  assert.deepEqual(result.trades, records);
  assert.equal(result.workbook.getWorksheet('交易记录').getCell('M2').text, '是');
  assert.deepEqual(calculateHoldings(result.trades), []);
  assert.equal(calculateHoldings([...records, trade('actual')]).length, 1);
  const { sameTrade } = require('../src/pages/TradingJournal/model.ts');
  assert.equal(sameTrade(trade(), { ...trade(), brainstorm: false }), true);
  assert.equal(sameTrade(trade(), { ...trade(), brainstorm: true }), false);
});
test('legacy twelve-column Excel remains readable and gains brainstorm column on save', async () => {
  const { workbook } = await readWorkbook();
  await writeWorkbook(workbook, [trade()]);
  workbook.getWorksheet('交易记录').spliceColumns(13, 2);
  const legacy = await readWorkbook(await workbook.xlsx.writeBuffer());
  assert.deepEqual(legacy.trades, [trade()]);
  const updated = await readWorkbook(await writeWorkbook(legacy.workbook, [{ ...trade(), brainstorm: true }]));
  assert.equal(updated.trades[0].brainstorm, true);
});

test('identity lookup gives same-market Excel names priority in both directions', async () => {
  const { resolveSecurity } = require('../src/pages/TradingJournal/security-lookup.ts');
  let calls = 0;
  const query = async () => { calls++; throw new Error('should not query'); };
  const records = [{ ...trade(), type: '美股', code: 'AAPL', name: '自定义苹果' },
    { ...trade('other'), type: '港股', code: 'AAPL', name: '其他市场' }];
  for (const [field, input] of [['code', 'aapl'], ['name', '自定义苹果']]) {
    const result = await resolveSecurity(records, '美股', field, input, new AbortController().signal, query);
    assert.equal(result.source, 'Excel');
    assert.deepEqual(result.identity, { code: 'AAPL', name: '自定义苹果' });
  }
  assert.equal(calls, 0);
});
test('external identity lookup requires an exact match in the selected market', async () => {
  const { resolveSecurity, selectEastmoneySecurity } = require('../src/pages/TradingJournal/security-lookup.ts');
  const payload = { QuotationCodeTable: { Data: [
    { Code: 'AAPL', Name: '苹果', Classify: 'UsStock' },
    { Code: '00005', Name: '汇丰控股', Classify: 'HK' },
    { Code: '600519', Name: '贵州茅台', Classify: 'AStock' },
    { Code: 'AAPLX', Name: '苹果相似项', Classify: 'UsStock' },
  ] } };
  for (const [type, code, name] of [['美股', 'AAPL', '苹果'], ['港股', '00005', '汇丰控股'], ['A股', '600519', '贵州茅台']]) {
    for (const [field, input] of [['code', code], ['name', name]]) {
      const result = await resolveSecurity([], type, field, input, new AbortController().signal, async () => payload);
      assert.deepEqual(result.identity, { code, name });
    }
  }
  assert.equal(selectEastmoneySecurity(payload, '港股', 'code', 'AAPL'), undefined);
  assert.equal(selectEastmoneySecurity(payload, '美股', 'name', '苹'), undefined);
  assert.equal(selectEastmoneySecurity({}, '美股', 'code', 'AAPL'), undefined);
  const duplicate = { QuotationCodeTable: { Data: [...payload.QuotationCodeTable.Data,
    { Code: 'OTHER', Name: '苹果', Classify: 'UsStock' }] } };
  assert.equal(selectEastmoneySecurity(duplicate, '美股', 'name', '苹果'), undefined);
  await assert.rejects(resolveSecurity([], '美股', 'code', 'AAPL', new AbortController().signal,
    async () => { throw new Error('offline'); }), /offline/);
});
test('Eastmoney JSONP requests encode input, handle callbacks, errors and cancellation', async () => {
  const { queryEastmoney } = require('../src/pages/TradingJournal/security-lookup.ts');
  const oldWindow = global.window;
  const oldDocument = global.document;
  const oldSetTimeout = global.setTimeout;
  let script;
  global.window = {};
  global.document = {
    createElement: () => ({ remove() { this.removed = true; } }),
    head: { appendChild(element) { script = element; } },
  };
  // Avoid keeping the test process alive for late-callback cleanup.
  global.setTimeout = (...args) => { const timer = oldSetTimeout(...args); timer.unref(); return timer; };
  try {
    const controller = new AbortController();
    const pending = queryEastmoney('苹果 & A', controller.signal);
    const params = new URL(script.src).searchParams;
    assert.equal(params.get('input'), '苹果 & A');
    assert.equal(params.get('type'), '14');
    const payload = { QuotationCodeTable: { Data: [] } };
    global.window[params.get('cb')](payload);
    assert.deepEqual(await pending, payload);
    assert.ok(script.removed);
    const cancelled = queryEastmoney('AAPL', controller.signal);
    const lateCallback = global.window[new URL(script.src).searchParams.get('cb')];
    controller.abort();
    await assert.rejects(cancelled, /取消/);
    assert.ok(script.removed);
    assert.doesNotThrow(() => lateCallback(payload));
    const failed = queryEastmoney('AAPL', new AbortController().signal);
    script.onerror();
    await assert.rejects(failed, /手动填写/);
  } finally {
    global.window = oldWindow;
    global.document = oldDocument;
    global.setTimeout = oldSetTimeout;
  }
});

test('only the five current asset categories are accepted', () => {
  for (const type of ['股票', '基金', '股票-港股', '股票-美股', '股票-A股']) {
    assert.throws(() => validateTrade({ ...trade(), type }), /交易分类无效/);
  }
});

test('stock total follows price and shares until manually adjusted, preserving decimal precision', () => {
  const { updatePricingDraft } = require('../src/pages/TradingJournal/model.ts');
  let draft = { type: '美股', price: '', shares: '', amount: '', amountManual: false };
  draft = updatePricingDraft(draft, 'price', '0.1');
  assert.equal(draft.amount, '');
  draft = updatePricingDraft(draft, 'shares', '3');
  assert.equal(draft.amount, '0.3');
  draft = updatePricingDraft(draft, 'price', '100');
  assert.equal(draft.amount, '300');
  draft = updatePricingDraft(draft, 'amount', '305');
  assert.equal(calculateFee(Number(draft.amount), Number(draft.price), Number(draft.shares)), 5);
  draft = updatePricingDraft(draft, 'shares', '2');
  assert.equal(draft.amount, '305');
  assert.equal(calculateFee(Number(draft.amount), Number(draft.price), Number(draft.shares)), 105);
  const fund = updatePricingDraft({ ...draft, type: '债券基金', amountManual: false }, 'price', '8');
  assert.equal(fund.amount, '305');
  const editing = updatePricingDraft({ ...draft, amount: '295', amountManual: true }, 'price', '100');
  assert.equal(editing.amount, '295');
  const empty = updatePricingDraft({ ...draft, amountManual: false }, 'shares', '');
  assert.equal(empty.amount, '');
});

test('stocks require positive shares while funds allow blank shares', async () => {
  for (const type of ['港股', '美股', 'A股']) {
    assert.throws(() => validateTrade({ ...trade(), type, shares: undefined }), /股票份额必填/);
    for (const shares of [0, -1, NaN, Infinity]) assert.throws(() => validateTrade({ ...trade(), type, shares }), /份额/);
    assert.doesNotThrow(() => validateTrade({ ...trade(), type, shares: 0.25 }));
  }
  for (const type of ['债券基金', '股票基金']) assert.doesNotThrow(() => validateTrade({ ...trade(), type, shares: undefined }));
});
test('market-specific stock code input filters, casing and complete-format checks', () => {
  const { normalizeCodeInput, validateStockCode } = require('../src/pages/TradingJournal/model.ts');
  assert.equal(normalizeCodeInput('A股', 'ab60051979'), '600519');
  assert.equal(normalizeCodeInput('港股', 'x00700y9'), '00700');
  assert.equal(normalizeCodeInput('美股', 'brk.b中1'), 'BRK.B');
  assert.equal(normalizeCodeInput('股票基金', 'fund-123'), 'FUND-123');
  for (const [type, codes] of [['A股', ['600519','000001','920001']], ['港股', ['00700','09988']], ['美股', ['A','AAPL','GOOGL','BRK.B','BF-B']]]) {
    for (const code of codes) assert.doesNotThrow(() => validateStockCode(type, code));
  }
  for (const [type, codes] of [['A股', ['60051','6005199','A00519']], ['港股', ['700','007000','HK700']], ['美股', ['aapl','600519','ABCDEF','BRK.','BRK..B','A123']]]) {
    for (const code of codes) assert.throws(() => validateStockCode(type, code));
  }
});

test('numeric stock codes pad on completion without changing empty inputs, US tickers or fund codes', () => {
  const { completeStockCode } = require('../src/pages/TradingJournal/model.ts');
  for (const [type,input,expected] of [['A股','1','000001'],['A股','000001','000001'],['A股','600519','600519'],['港股','700','00700'],['港股','0700','00700'],['港股','00700','00700'],['港股','',''],['A股','',''],['美股','AAPL','AAPL'],['债券基金','1','1'],['A股','1234567','1234567']]) {
    assert.equal(completeStockCode(type,input),expected);
  }
});
test('stock identity lookup pads recorded, external query and reverse-lookup codes consistently', async () => {
  const { resolveSecurity } = require('../src/pages/TradingJournal/security-lookup.ts');
  const records=[{ ...trade(), type:'港股', code:'00700', name:'自定义腾讯' }];
  const signal=new AbortController().signal;
  const recorded=await resolveSecurity(records,'港股','code','700',signal,async()=>{throw Error('unexpected request')});
  assert.equal(recorded.source,'Excel');assert.equal(recorded.identity.code,'00700');
  const short=[{ ...trade(),type:'A股',code:'1',name:'自定义平安' }];
  assert.equal((await resolveSecurity(short,'A股','name','自定义平安',signal)).identity.code,'000001');
  let request;
  const query=async input=>{ request=input; return {QuotationCodeTable:{Data:[{Code:'700',Name:'腾讯',Classify:'HK'}]}}; };
  const external=await resolveSecurity([],'港股','code','700',signal,query);
  assert.equal(request,'00700');assert.equal(external.identity.code,'00700');
  assert.equal((await resolveSecurity([],'港股','name','腾讯',signal,query)).identity.code,'00700');
});

test('all asset types uppercase English letters without altering numeric padding rules', () => {
  const { normalizeCodeInput, completeStockCode } = require('../src/pages/TradingJournal/model.ts');
  for (const type of ['债券基金','股票基金']) assert.equal(normalizeCodeInput(type,'ab中-123z'),'AB中-123Z');
  assert.equal(normalizeCodeInput('美股','brk.b'),'BRK.B');
  assert.equal(completeStockCode('港股',normalizeCodeInput('港股','a700b')),'00700');
  assert.equal(completeStockCode('A股',normalizeCodeInput('A股','x1y')),'000001');
});

test('stock currencies are fixed by market and fund currency survives Excel, edits and sync conflicts', async () => {
  const {tradeCurrency,sameTrade}=require('../src/pages/TradingJournal/model.ts');
  for(const [type,currency] of [['港股','HKD'],['美股','USD'],['A股','RMB']]) {
    assert.equal(tradeCurrency({...trade(),type}),currency);
    assert.ok(sameTrade({...trade(),type},{...trade(),type,currency}));
    assert.throws(()=>validateTrade({...trade(),type,currency:currency==='USD'?'HKD':'USD'}),/货币/);
  }
  const records=['HKD','USD','RMB'].map((currency,index)=>({...trade(String(index)),currency}));
  const {workbook}=await readWorkbook();
  const result=await readWorkbook(await writeWorkbook(workbook,records));
  assert.deepEqual(result.trades,records);
  assert.equal(result.workbook.getWorksheet('交易记录').getCell('N1').text,'货币标记');
  assert.equal(result.workbook.getWorksheet('交易记录').getCell('N2').text,'HKD');
  assert.equal(sameTrade(records[0],{...records[0],currency:'USD'}),false);
  const change=queueChange(records,[],[],records[0],{...records[0],currency:'USD'});
  assert.equal(mergeForSync(records,[],change)[0].currency,'USD');
  assert.throws(()=>mergeForSync([{...records[0],currency:'RMB'},...records.slice(1)],[],change),/其他设备/);
  assert.throws(()=>validateTrade({...trade(),currency:'EUR'}),/货币标记/);
});
test('older Excel records keep unknown fund currencies while deriving stock defaults when saved', async () => {
  const {workbook}=await readWorkbook();
  await writeWorkbook(workbook,[trade(),{...trade('stock'),type:'美股'}]);
  workbook.getWorksheet('交易记录').spliceColumns(14,1);
  const legacy=await readWorkbook(await workbook.xlsx.writeBuffer());
  assert.equal(legacy.trades[0].currency,undefined);
  assert.equal(legacy.trades[1].currency,undefined);
  const saved=await readWorkbook(await writeWorkbook(legacy.workbook,legacy.trades));
  assert.equal(saved.trades[0].currency,undefined);
  assert.equal(saved.trades[1].currency,'USD');
});
test('holdings never merge different fund currencies or unknown historical currency', () => {
  const {calculateHoldings}=require('../src/pages/TradingJournal/holdings.ts');
  const records=[{...trade('usd'),currency:'USD'}, {...trade('rmb'),currency:'RMB'},trade('unknown')];
  const holdings=calculateHoldings(records);
  assert.equal(holdings.length,3);
  for(const holding of holdings) assert.equal(holding.totalCost,trade().amount);
  assert.deepEqual(new Set(holdings.map(row=>row.currency)),new Set(['USD','RMB',undefined]));
});

test('holding cost summary shows all currencies and excludes closed, brainstorm and unmarked positions', () => {
  const {calculateHoldings,summarizeHoldingCosts}=require('../src/pages/TradingJournal/holdings.ts');
  const records=[
    {...trade('usd-buy'),type:'美股',code:'AAPL',amount:100,shares:10,fee:99},
    {...trade('usd-sell'),type:'美股',code:'AAPL',direction:'卖出',amount:40,shares:4,fee:99},
    {...trade('hk'),type:'港股',code:'00700',amount:200,shares:20},
    {...trade('rmb'),currency:'RMB',amount:300,shares:30},
    {...trade('closed-buy'),type:'美股',code:'IBM',amount:100,shares:10},
    {...trade('closed-sell'),type:'美股',code:'IBM',direction:'卖出',amount:130,shares:10},
    {...trade('idea'),type:'港股',code:'09988',amount:1000000,shares:100,brainstorm:true},
    {...trade('legacy'),code:'LEGACY',amount:500,shares:50},
  ];
  assert.deepEqual(summarizeHoldingCosts(calculateHoldings(records)),{HKD:200,USD:60,RMB:300});
  assert.deepEqual(summarizeHoldingCosts([]),{HKD:0,USD:0,RMB:0});
});
