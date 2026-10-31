const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const ts = require('typescript');
require.extensions['.ts'] = (m, f) => m._compile(ts.transpileModule(fs.readFileSync(f, 'utf8'), { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2020, esModuleInterop: true } }).outputText, f);
const { InteractionRequiredAuthError } = require('@azure/msal-browser');
const { OneDriveSession } = require('../src/services/onedrive-session.ts');
const { OneDriveJournal } = require('../src/pages/TradingJournal/onedrive.ts');
const { MonthlyDrive } = require('../src/pages/MonthlyReview/onedrive.ts');
const accountA = { homeAccountId: 'account-a', username: 'a@example.test' };
const accountB = { homeAccountId: 'account-b', username: 'b@example.test' };
function fixture() {
  const storage = new Map(); const state = { accounts: [], next: accountA, init: 0, logins: 0, tokenPopups: 0, expired: false, clear: 0 };
  const auth = {
    async initialize() { state.init++; },
    getAllAccounts() { return state.accounts; },
    setActiveAccount(account) { state.active = account; },
    async acquireTokenSilent({ account }) { if (state.expired) throw new InteractionRequiredAuthError('interaction_required'); return { accessToken: `token-${account.homeAccountId}`, account }; },
    async acquireTokenPopup({ account }) { state.tokenPopups++; state.expired = false; return { accessToken: `token-${account.homeAccountId}`, account }; },
    async loginPopup() { state.logins++; if (!state.accounts.some(a => a.homeAccountId === state.next.homeAccountId)) state.accounts.push(state.next); return { account: state.next }; },
    async clearCache() { state.clear++; /* Retain fake cached accounts to exercise the logout tombstone. */ },
  };
  const session = new OneDriveSession('client-a', auth, { getItem: key => storage.get(key) ?? null, setItem: (key, value) => storage.set(key, value) });
  return { session, auth, storage, state };
}
test('monthly and journal connections reuse one login and keep independent target paths', async () => {
  const { session, state } = fixture();
  const monthly = Object.create(MonthlyDrive.prototype); monthly.session = session; monthly.folder = 'monthly/first'; monthly.config = { clientId: 'client-a', path: 'monthly/first/monthly.xlsx' };
  const journal = Object.create(OneDriveJournal.prototype); journal.session = session; journal.config = { clientId: 'client-a', path: 'journal/first.xlsx' };
  assert.equal((await monthly.connect()).homeAccountId, 'account-a');
  assert.equal((await journal.restore()).homeAccountId, 'account-a');
  assert.equal((await journal.connect()).homeAccountId, 'account-a');
  const switched = Object.create(MonthlyDrive.prototype); switched.session = session; switched.folder = 'monthly/second'; switched.config = { clientId: 'client-a', path: 'monthly/second/monthly.xlsx' };
  await switched.connect();
  assert.equal(state.logins, 1); assert.equal(state.init, 1);
  assert.equal(journal.config.path, 'journal/first.xlsx'); assert.equal(monthly.folder, 'monthly/first'); assert.equal(switched.folder, 'monthly/second');
  assert.equal(await journal.accessToken(), 'token-account-a');
});
test('concurrent connect requests open only one login popup', async () => {
  const { session, state } = fixture();
  const users = await Promise.all([session.connect(), session.connect()]);
  assert.equal(users[0].homeAccountId, users[1].homeAccountId); assert.equal(state.logins, 1); assert.equal(state.init, 1);
});
test('selected shared account takes precedence over legacy preferences and invalidates old clients', async () => {
  const { session, state } = fixture(); await session.connect();
  const old = Object.create(OneDriveJournal.prototype); old.session = session; await old.restore('account-a');
  state.next = accountB; await session.connect(true);
  assert.equal((await session.restore('account-a')).homeAccountId, 'account-b');
  await assert.rejects(old.accessToken(), /账户|状态/);
  assert.equal(await session.token('account-b', false), 'token-account-b');
});
test('disconnect prevents automatic relogin through cached accounts or legacy feature settings', async () => {
  const { session, state } = fixture(); await session.connect(); await session.disconnect('account-a');
  assert.equal(state.clear, 1); assert.equal(await session.restore('account-a'), null);
  await assert.rejects(session.token('account-a', false), /状态|断开/);
  await session.connect(); assert.equal(state.logins, 2);
});
test('silent restore and background work never show a popup, while explicit work can renew auth', async () => {
  const { session, state } = fixture(); await session.connect(); state.expired = true;
  await assert.rejects(session.restore(), InteractionRequiredAuthError);
  await assert.rejects(session.token('account-a', false), /登录已过期/);
  assert.equal(state.tokenPopups, 0); assert.equal(state.logins, 1);
  assert.equal(await session.token('account-a', true), 'token-account-a'); assert.equal(state.tokenPopups, 1);
  state.expired = true; await session.connect(); assert.equal(state.tokenPopups, 2); assert.equal(state.logins, 1);
});
test('a token finishing after disconnect cannot authorize an old operation', async () => {
  const { session, auth } = fixture(); await session.connect(); let finish;
  auth.acquireTokenSilent = () => new Promise(resolve => { finish = resolve; });
  const token = session.token('account-a', false); await new Promise(resolve => setImmediate(resolve));
  await session.disconnect('account-a'); finish({ accessToken: 'old-token', account: accountA });
  await assert.rejects(token, /状态|账户/);
});
test('a delayed login cannot undo a disconnect', async () => {
  const { session, auth } = fixture(); let finish;
  auth.loginPopup = () => new Promise(resolve => { finish = resolve; });
  const login = session.connect(); await new Promise(resolve => setImmediate(resolve));
  await session.disconnect(); finish({ account: accountA });
  await assert.rejects(login, /状态|账户/); assert.equal(await session.restore(), null);
});
test('different Microsoft applications have independent login identity', async () => {
  const { session, state, auth, storage } = fixture(); await session.connect();
  const other = new OneDriveSession('client-b', { ...auth, getAllAccounts: () => [] }, { getItem: key => storage.get(key) ?? null, setItem: (key, value) => storage.set(key, value) });
  assert.equal(await other.restore(), null); await other.disconnect();
  assert.equal((await session.restore()).homeAccountId, 'account-a'); assert.equal(state.logins, 1);
});
