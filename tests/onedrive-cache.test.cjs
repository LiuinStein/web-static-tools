const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const ts = require('typescript');
require.extensions['.ts'] = (m, f) => m._compile(ts.transpileModule(fs.readFileSync(f, 'utf8'), { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2020, esModuleInterop: true } }).outputText, f);
const sessionModule = require('../src/services/onedrive-session.ts');
const { journalDrive } = require('../src/pages/TradingJournal/onedrive.ts');
const { monthlyDrive } = require('../src/pages/MonthlyReview/onedrive.ts');
const { readWorkbook, writeWorkbook } = require('../src/pages/TradingJournal/workbook.ts');
const A = { homeAccountId: 'a', username: 'a@test.invalid' }, B = { homeAccountId: 'b', username: 'b@test.invalid' };
const clientId = '11111111-1111-1111-1111-111111111111';
let fixtureId = 0;
async function fixture() {
  const storage = new Map(); let silent = 0, active = A;
  const auth = {
    async initialize() {}, getAllAccounts() { return [A, B]; }, setActiveAccount() {},
    async acquireTokenSilent({ account }) { silent++; return { accessToken: account.homeAccountId, account }; },
    async loginPopup() { return { account: active }; }, async clearCache() {},
    async acquireTokenPopup() { throw Error('unexpected popup'); },
  };
  const session = new sessionModule.OneDriveSession(clientId, auth, { getItem: k => storage.get(k) ?? null, setItem: (k, v) => storage.set(k, v) });
  sessionModule.oneDriveSession = () => session;
  await session.connect();
  const path = `case-${++fixtureId}`;
  return { session, path, silent: () => silent, switch: async () => { active = B; await session.connect(true); } };
}
async function bytes(id = 'trade-a') {
  const { workbook } = await readWorkbook();
  return writeWorkbook(workbook, [{ id, date: '2026-11-03', type: '美股', code: '000001', name: id, stance: '看多', direction: '买入', amount: 100, price: 1, shares: 100, fee: 0, reason: '' }]);
}
function transport(service, initial) {
  const state = { data: initial, eTag: 'v1', downloads: 0, metadata: 0, uploads: 0, beforeContent: undefined, mutateAfterContent: false };
  service.client = { api(endpoint) {
    const q = { select() { return q; }, query() { return q; }, responseType() { return q; }, header() { return q; },
      async get() {
        await service.accessToken();
        if (endpoint.endsWith('/content')) {
          state.downloads++; if (state.beforeContent) await state.beforeContent();
          const data = state.data; if (state.mutateAfterContent) state.eTag = 'changed-during-read'; return data;
        }
        state.metadata++; return { id: 'file', name: 'month.xlsx', eTag: state.eTag, size: state.data.byteLength, webUrl: 'https://onedrive.live.com/test-file', file: {} };
      },
      async put(body) { state.uploads++; state.data = await body.arrayBuffer(); state.eTag = 'saved'; return { id: 'file', eTag: 'saved' }; },
    }; return q;
  } };
  return state;
}
test('journal reentry shares the service and parsed version cache; changed versions reload', async () => {
  const f = await fixture(); const config = { clientId, path: `${f.path}/journal.xlsx` };
  const service = journalDrive(config); await service.restore(); const state = transport(service, await bytes());
  (await service.read())[0].name = 'caller mutation';
  const again = journalDrive({ clientId: clientId.toUpperCase(), path: `/${config.path}/` });
  assert.equal(again, service); await again.restore();
  const before = state.metadata;
  assert.equal((await again.read())[0].name, 'trade-a');
  assert.equal(state.downloads, 1); assert.equal(state.metadata - before, 1);
  state.eTag = 'v2'; state.data = await bytes('trade-updated');
  assert.equal((await again.read())[0].id, 'trade-updated'); assert.equal(state.downloads, 2);
  assert.notEqual(journalDrive({ clientId, path: `${f.path}/other.xlsx` }), service);
});
test('account changes reject old connections and invalidate their file cache before reuse', async () => {
  const f = await fixture(); const service = journalDrive({ clientId, path: `${f.path}/journal.xlsx` });
  await service.restore(); const state = transport(service, await bytes()); await service.read();
  await f.switch(); assert.equal(service.currentAccount(), null);
  await assert.rejects(service.read(), /账户|状态/);
  await service.restore(); state.data = await bytes('trade-b');
  assert.equal((await service.read())[0].id, 'trade-b'); assert.equal(state.downloads, 2);
});
test('a download finishing after account switch cannot poison the next account cache', async () => {
  const f = await fixture(); const service = journalDrive({ clientId, path: `${f.path}/journal.xlsx` });
  await service.restore(); const state = transport(service, await bytes());
  let entered, finish; const waiting = new Promise(resolve => { entered = resolve; });
  state.beforeContent = async () => { entered(); await new Promise(resolve => { finish = resolve; }); };
  const oldRead = service.read(); await waiting; await f.switch(); await service.restore(); finish();
  await assert.rejects(oldRead, /账户|状态/); assert.equal(service.cachedTrades(), null);
  state.beforeContent = undefined; state.data = await bytes('trade-b');
  assert.equal((await service.read())[0].id, 'trade-b');
});
test('monthly transport shares login, checks eTags, isolates bytes, and invalidates upload caches', async () => {
  const f = await fixture(); const service = monthlyDrive(clientId, f.path); await service.restore();
  assert.equal(monthlyDrive(clientId, `/${f.path}/`), service);
  const state = transport(service, new Uint8Array([1, 2, 3]).buffer);
  const file = { id: 'file', name: 'month.xlsx', eTag: 'v1', size: 3 };
  const first = await service.download(file); new Uint8Array(first.data)[0] = 99;
  assert.equal(new Uint8Array((await service.download(file)).data)[0], 1); assert.equal(state.downloads, 1);
  state.eTag = 'v2'; await service.download(file); assert.equal(state.downloads, 2);
  service.ensureFolder = async () => {};
  await service.publish(file.name, new Uint8Array([4,5,6])); assert.equal(state.uploads,1);
  assert.equal(service.downloads.size,0); assert.equal(service.fileList,undefined);
  state.mutateAfterContent = true;
  await assert.rejects(service.download(file), /文件在读取期间发生变化/);
});
test('monthly directory refresh is coalesced and cached files are scoped to identity', async () => {
  const f = await fixture(); const service = monthlyDrive(clientId, f.path); await service.restore();
  let calls = 0;
  service.client = { api() { return { async get() { calls++; return { value: [{ id: 'file', name: 'month.xlsx', file: {}, eTag: 'v1' }] }; } }; } };
  await Promise.all([service.list(), service.list()]); assert.equal(calls, 1);
  service.cachedFiles()[0].name = 'mutated'; assert.equal(service.cachedFiles()[0].name, 'month.xlsx');
  await f.switch(); assert.deepEqual(service.cachedFiles(), []); await service.restore(); assert.deepEqual(service.cachedFiles(), []);
});
test('loading feature modules does not load ExcelJS or JSZip; monthly transport does not import journal workbooks', () => {
  const { execFileSync } = require('node:child_process');
  execFileSync(process.execPath, ['-e', `
    const fs = require('fs'), ts = require('typescript'), assert = require('assert/strict');
    require.extensions['.ts'] = (m, f) => m._compile(ts.transpileModule(fs.readFileSync(f, 'utf8'), { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2020, esModuleInterop: true } }).outputText, f);
    require('./src/pages/MonthlyReview/onedrive.ts');
    assert.equal(require.cache[require.resolve('./src/pages/TradingJournal/workbook.ts')], undefined);
    require('./src/pages/MonthlyReview/workbook.ts'); require('./src/pages/TradingJournal/workbook.ts');
    assert.equal(require.cache[require.resolve('exceljs')], undefined);
    assert.equal(require.cache[require.resolve('jszip')], undefined);
  `], { cwd: require('path').resolve(__dirname, '..') });
});
