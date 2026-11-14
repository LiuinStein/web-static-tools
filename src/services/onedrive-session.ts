import { PublicClientApplication, CacheLookupPolicy, AccountInfo } from '@azure/msal-browser';
import { OneDriveAuthRequiredError, isOneDriveAuthRequired } from './onedrive-auth';

type AuthClient = Pick<PublicClientApplication, 'initialize' | 'getAllAccounts' | 'setActiveAccount' | 'acquireTokenSilent' | 'acquireTokenPopup' | 'loginPopup' | 'clearCache'>;
type SessionStorage = Pick<Storage, 'getItem' | 'setItem'>;
const scopes = ['Files.ReadWrite'];

// One Microsoft client/session per application ID. File paths belong to the features,
// never to this session. Only account identity metadata is stored here; MSAL owns tokens.
export class OneDriveSession {
  private initialization?: Promise<void>;
  private connecting?: Promise<AccountInfo>;
  private refreshing?: Promise<string>;
  private epoch = 0;
  private restoredAccount?: AccountInfo;
  private restoring?: Promise<AccountInfo | null>;
  private interactionRequired = new Set<string>();
  get revision() { return this.epoch; }
  currentAccount(): AccountInfo | null {
    const account = this.restoredAccount;
    return account && this.find()?.homeAccountId === account.homeAccountId ? account : null;
  }
  private readonly key: string;
  constructor(readonly clientId: string, private auth: AuthClient, private storage: SessionStorage) {
    this.key = `onedrive:session:v1:${clientId}`;
  }
  private initialize() {
    if (!this.initialization) this.initialization = this.auth.initialize().catch(error => { this.initialization = undefined; throw error; });
    return this.initialization;
  }
  private selection(): { accountId: string | null } | null {
    try { const raw = this.storage.getItem(this.key); if (raw === null) return null; const value = JSON.parse(raw); if (value?.accountId === null || typeof value?.accountId === 'string') return value; } catch { /* Ignore malformed identity metadata. */ }
    return null;
  }
  private find(preferredId?: string): AccountInfo | null {
    const selected = this.selection();
    // An explicit disconnect must not be undone by old feature-specific preferences.
    if (selected?.accountId === null) return null;
    const accounts = this.auth.getAllAccounts(), id = selected?.accountId || preferredId;
    return id ? accounts.find(a => a.homeAccountId === id) || null : accounts.length === 1 ? accounts[0] : null;
  }
  private select(account: AccountInfo) {
    this.storage.setItem(this.key, JSON.stringify({ accountId: account.homeAccountId }));
    this.auth.setActiveAccount(account);
  }
  private check(epoch: number, expectedId?: string) {
    const selected = this.selection();
    if (epoch !== this.epoch || (expectedId && selected && selected.accountId !== expectedId)) throw new Error('OneDrive 账户或登录状态已变化，请重新连接当前页面');
  }
  private async silentToken(account: AccountInfo) {
    if (this.interactionRequired.has(account.homeAccountId)) throw new OneDriveAuthRequiredError();
    try {
      // Refresh tokens work without third-party cookies; never fall back to a hidden iframe.
      return await this.auth.acquireTokenSilent({ scopes, account, cacheLookupPolicy: CacheLookupPolicy.AccessTokenAndRefreshToken });
    } catch (error) {
      if (!isOneDriveAuthRequired(error)) throw error;
      this.interactionRequired.add(account.homeAccountId);
      throw new OneDriveAuthRequiredError();
    }
  }
  async restore(preferredId?: string): Promise<AccountInfo | null> {
    const current = this.currentAccount();
    if (current) return current;
    if (this.restoring) return this.restoring;
    const epoch = this.epoch;
    const task = (async () => {
      await this.initialize(); this.check(epoch);
      const account = this.find(preferredId); if (!account) return null;
      await this.silentToken(account); this.check(epoch, account.homeAccountId);
      this.select(account); this.restoredAccount = account; return account;
    })();
    this.restoring = task;
    try { return await task; } finally { if (this.restoring === task) this.restoring = undefined; }
  }
  async connect(switchAccount = false): Promise<AccountInfo> {
    if (this.connecting) return this.connecting;
    const epoch = this.epoch;
    const task = async () => {
      await this.initialize(); this.check(epoch);
      if (!switchAccount) {
        const account = this.find();
        if (account) {
          try { await this.silentToken(account); }
          catch (error) {
            if (!isOneDriveAuthRequired(error)) throw error;
            this.check(epoch, account.homeAccountId);
            await this.popupToken(account, epoch);
          }
          this.check(epoch, account.homeAccountId); this.select(account); this.restoredAccount = account; return account;
        }
      }
      const result = await this.auth.loginPopup({ scopes, prompt: 'select_account' });
      this.check(epoch);
      if (!result.account) throw new Error('Microsoft 登录未返回账户');
      this.interactionRequired.delete(result.account.homeAccountId);
      this.epoch += 1; this.restoring = undefined; this.select(result.account); this.restoredAccount = result.account; return result.account;
    };
    this.connecting = task();
    try { return await this.connecting; } finally { this.connecting = undefined; }
  }
  private async popupToken(account: AccountInfo, epoch: number): Promise<string> {
    if (!this.refreshing) {
      this.refreshing = (async () => {
        let result;
        try { result = await this.auth.acquireTokenPopup({ scopes, account }); }
        catch (error) {
          if (error.errorCode === 'popup_window_error' || error.errorCode === 'empty_window_error') throw new OneDriveAuthRequiredError('浏览器阻止了 Microsoft 登录窗口。请允许此站点弹出窗口，再点击「重新授权 OneDrive」。本机草稿不受影响。');
          throw error;
        }
        this.check(epoch, account.homeAccountId);
        if (result.account && result.account.homeAccountId !== account.homeAccountId) throw new Error('授权账户与当前文件账户不一致，请使用「切换账户」重新连接');
        this.interactionRequired.delete(account.homeAccountId);
        return result.accessToken;
      })();
    }
    try { return await this.refreshing; } finally { this.refreshing = undefined; }
  }
  async token(accountId: string, interactive: boolean): Promise<string> {
    const epoch = this.epoch; await this.initialize(); this.check(epoch, accountId);
    const account = this.find();
    if (!account || account.homeAccountId !== accountId) throw new Error('OneDrive 已断开或账户已切换，请重新连接当前页面');
    let token: string;
    try { token = (await this.silentToken(account)).accessToken; }
    catch (error) {
      if (!isOneDriveAuthRequired(error)) throw error;
      if (!interactive) throw error;
      this.check(epoch, accountId);
      token = await this.popupToken(account, epoch);
    }
    this.check(epoch, accountId); return token;
  }
  async disconnect(expectedId?: string): Promise<void> {
    await this.initialize(); this.check(this.epoch, expectedId);
    const account = this.find(); this.epoch += 1; this.restoredAccount = undefined; this.restoring = undefined;
    this.interactionRequired.clear();
    this.storage.setItem(this.key, JSON.stringify({ accountId: null }));
    this.auth.setActiveAccount(null);
    if (account) await this.auth.clearCache({ account });
  }
}

const sessions = new Map<string, OneDriveSession>();
export function oneDriveSession(clientId: string): OneDriveSession {
  const id = clientId.trim().toLowerCase();
  if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/.test(id)) throw new Error('请输入有效的 Microsoft 应用客户端 ID');
  let session = sessions.get(id);
  if (!session) {
    const auth = new PublicClientApplication({ auth: { clientId: id, authority: 'https://login.microsoftonline.com/common', redirectUri: `${window.location.origin}${window.location.pathname}` }, cache: { cacheLocation: 'localStorage' } });
    session = new OneDriveSession(id, auth, window.localStorage); sessions.set(id, session);
  }
  return session;
}
