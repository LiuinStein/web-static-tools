const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const ts = require('typescript');
require.extensions['.ts'] = (m, f) => m._compile(ts.transpileModule(fs.readFileSync(f, 'utf8'), { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2020, esModuleInterop: true } }).outputText, f);
const { draftIdentity, uniqueDrafts, draftOptionLabel } = require('../src/pages/MonthlyReview/storage.ts');
const draft = (id, extra = {}) => ({ id, name: '2026-10.xlsx', data: new Uint8Array([Number(id) || 1]), updated: '2026-10-31T12:00:00.000Z', ...extra });
test('same-name local imports consolidate to the latest saved content', () => {
  const old = draft('1'), latest = draft('2', { updated: '2026-10-31T13:00:00.000Z' });
  const result = uniqueDrafts([old, latest]); assert.equal(result.length, 1); assert.equal(result[0].id, '2'); assert.equal(result[0].data[0], 2);
});
test('same-name local and cloud workbooks remain separate and show their sources', () => {
  const local = draft('1'), cloud = draft('2', { scope: 'client:account-a:文档/账本', source: { id: 'cloud-file' } });
  const all = uniqueDrafts([local, cloud]); assert.equal(all.length, 2);
  assert.equal(draftOptionLabel(local, all), '2026-10.xlsx · 本地'); assert.equal(draftOptionLabel(cloud, all), '2026-10.xlsx · OneDrive');
});
test('cloud origin is the account and directory, not a particular login application or replaced file ID', () => {
  const first = draft('1', { scope: 'client-a:account-a:Folder', source: { id: 'old-file' } });
  const second = draft('2', { scope: 'client-b:account-a:folder', name: '2026-10.XLSX', source: { id: 'replacement-file' } });
  assert.equal(draftIdentity(first), draftIdentity(second)); assert.equal(uniqueDrafts([first, second]).length, 1);
});
test('different cloud accounts and directories do not replace each other', () => {
  const rows = [draft('1', { scope: 'client:account-a:FolderA' }), draft('2', { scope: 'client:account-a:FolderB' }), draft('3', { scope: 'client:account-b:FolderA' })];
  assert.equal(uniqueDrafts(rows).length, 3); assert.equal(new Set(rows.map(row => draftOptionLabel(row, rows))).size, 3);
});
test('unrelated filenames and legacy records with only a cloud file ID remain intact', () => {
  const rows = [draft('1'), draft('2', { name: '2026-11.xlsx' }), draft('3', { source: { id: 'legacy-cloud' } })];
  assert.equal(uniqueDrafts(rows).length, 3); assert.notEqual(draftIdentity(rows[0]), draftIdentity(rows[2]));
});
