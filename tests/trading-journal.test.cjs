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
  return { id, date: '2026-10-29', type: '基金', code: '005827', name: '示例基金', stance: '看多', direction: '买入', amount: 1001.5, price: 1, shares: 1000, fee: 1.5, reason: '第一行\n第二行，记录完整交易逻辑。' };
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
const { InteractionRequiredAuthError } = require('@azure/msal-browser');
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
  service.auth = {
    async acquireTokenSilent() { throw new InteractionRequiredAuthError('interaction_required'); },
    async acquireTokenPopup() { popups += 1; return { accessToken: 'test-token' }; },
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
