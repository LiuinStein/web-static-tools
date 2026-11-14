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
  assert.equal((await session.restore()).homeAccountId, 'account-a'); // Reuse identity; token validity is checked at request time.
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

test('returning to either feature reuses restored identity without another silent token request', async () => {
  const { session, auth, state } = fixture(); state.accounts = [accountA];
  let silent = 0; const original = auth.acquireTokenSilent;
  auth.acquireTokenSilent = async args => { silent++; return original(args); };
  await Promise.all([session.restore(), session.restore()]);
  await session.restore(); await session.restore();
  assert.equal(state.init, 1); assert.equal(silent, 1);
  assert.equal(session.currentAccount().homeAccountId, accountA.homeAccountId);
  await session.token(accountA.homeAccountId, false); assert.equal(silent, 2);
  await session.disconnect(); assert.equal(session.currentAccount(), null);
});

test('iframe timeouts require explicit reauthorization, skip repeated silent attempts and recover without a new login', async () => {
  const { CacheLookupPolicy, BrowserAuthError } = require('@azure/msal-browser');
  const { session, auth, state } = fixture(); state.accounts=[accountA];
  let timedOut=true,calls=0; const silent=auth.acquireTokenSilent,popup=auth.acquireTokenPopup;
  auth.acquireTokenSilent=async request=>{calls++;assert.equal(request.cacheLookupPolicy,CacheLookupPolicy.AccessTokenAndRefreshToken);if(timedOut)throw new BrowserAuthError('monitor_window_timeout','timeout');return silent(request)};
  auth.acquireTokenPopup=async request=>{timedOut=false;return popup(request)};
  await assert.rejects(session.restore(),/重新授权 OneDrive/);
  await assert.rejects(session.restore(),/重新授权 OneDrive/);
  assert.equal(calls,1);assert.equal(state.tokenPopups,0);assert.equal(state.logins,0);
  assert.equal((await session.connect()).homeAccountId,accountA.homeAccountId);
  assert.equal(state.tokenPopups,1);assert.equal(state.logins,0);
  assert.equal(await session.token(accountA.homeAccountId,false),'token-account-a');
  assert.equal(calls,2);
});

test('interactive token requests recover iframe timeouts but do not hide network errors', async () => {
  const { BrowserAuthError }=require('@azure/msal-browser');
  const {session,auth,state}=fixture();await session.connect();
  auth.acquireTokenSilent=async()=>{throw new BrowserAuthError('monitor_window_timeout','timeout')};
  await assert.rejects(session.token(accountA.homeAccountId,false),/登录已过期或静默授权超时/);
  assert.equal(state.tokenPopups,0);
  assert.equal(await session.token(accountA.homeAccountId,true),'token-account-a');assert.equal(state.tokenPopups,1);
  auth.acquireTokenSilent=async()=>{throw new Error('network disconnected')};
  await assert.rejects(session.token(accountA.homeAccountId,true),/network disconnected/);
  assert.equal(state.tokenPopups,1);
});

test('blocked auth popups remain recoverable and a timeout after disconnect cannot reopen authorization', async () => {
  const {session,auth,state}=fixture();await session.connect();state.expired=true;
  const popup=auth.acquireTokenPopup;
  auth.acquireTokenPopup=async()=>{throw {errorCode:'popup_window_error'}};
  await assert.rejects(session.token(accountA.homeAccountId,true),/允许此站点弹出窗口/);
  auth.acquireTokenPopup=popup;await session.connect();assert.equal(state.tokenPopups,1);
  let reject;auth.acquireTokenSilent=()=>new Promise((_,fail)=>{reject=fail});
  const request=session.token(accountA.homeAccountId,true);await new Promise(resolve=>setImmediate(resolve));await session.disconnect();
  reject({errorCode:'monitor_window_timeout'});await assert.rejects(request,/状态|账户/);assert.equal(state.tokenPopups,1);
});

test('only child-window Microsoft auth responses bypass the application hash router', () => {
  const {isOneDriveAuthCallback,isOneDriveAuthRequired,OneDriveAuthRequiredError}=require('../src/services/onedrive-auth.ts');
  assert.equal(isOneDriveAuthCallback({hash:'#code=fake&state=fake',search:''},true),true);
  assert.equal(isOneDriveAuthCallback({hash:'#error=login_required&state=fake',search:''},true),true);
  assert.equal(isOneDriveAuthCallback({hash:'',search:'?code=fake&state=fake'},true),true);
  assert.equal(isOneDriveAuthCallback({hash:'#code=fake&state=fake',search:''},false),false);
  assert.equal(isOneDriveAuthCallback({hash:'#/monthly-review?code=fake&state=fake',search:''},true),false);
  assert.equal(isOneDriveAuthCallback({hash:'#state=fake',search:''},true),false);
  assert.equal(isOneDriveAuthRequired({cause:new OneDriveAuthRequiredError()}),true);
  assert.equal(isOneDriveAuthRequired(new Error('network disconnected')),false);
});
test('shared factory persists login across reopened tabs and keeps explicit disconnect persistent', async () => {
  const vm = require('node:vm');
  const source = ts.transpileModule(fs.readFileSync(require.resolve('../src/services/onedrive-session.ts'), 'utf8'), { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2020 } }).outputText;
  const data = new Map(), configs = [];
  const persistent = { getItem: key => data.get(key) ?? null, setItem: (key,value) => data.set(key,value) };
  let popups = 0;
  class FakeAuth {
    constructor(config) { configs.push(config); this.store = config.cache.cacheLocation === 'localStorage' ? persistent : { getItem: () => null, setItem() {} }; }
    async initialize() {}
    getAllAccounts() { return JSON.parse(this.store.getItem('fake:accounts') || '[]'); }
    setActiveAccount() {}
    async acquireTokenSilent({account}) { return {account,accessToken:'fake'}; }
    async loginPopup() { popups++; this.store.setItem('fake:accounts',JSON.stringify([accountA])); return {account:accountA}; }
    async clearCache() { this.store.setItem('fake:accounts','[]'); }
  }
  function openTab() {
    const module = {exports:{}};
    vm.runInNewContext(source, { exports:module.exports, module, require: name => name === '@azure/msal-browser' ? { PublicClientApplication: FakeAuth, CacheLookupPolicy: {AccessTokenAndRefreshToken:1} } : require('../src/services/onedrive-auth.ts'),
      window:{localStorage:persistent,sessionStorage:{getItem:()=>null,setItem(){}},location:{origin:'https://tools.test',pathname:'/'}} });
    return module.exports.oneDriveSession('11111111-1111-1111-1111-111111111111');
  }
  const first = openTab(); await first.connect();
  const reopened = openTab(); assert.equal((await reopened.restore()).homeAccountId,accountA.homeAccountId);
  assert.equal(popups,1); assert.ok(configs.every(config=>config.cache.cacheLocation==='localStorage'));
  assert.equal(JSON.parse(persistent.getItem('onedrive:session:v1:11111111-1111-1111-1111-111111111111')).accountId,accountA.homeAccountId);
  await reopened.disconnect();
  assert.equal(await openTab().restore(accountA.homeAccountId),null);
  assert.equal(popups,1);
});
