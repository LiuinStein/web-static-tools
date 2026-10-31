import { PublicClientApplication, InteractionRequiredAuthError, AccountInfo } from '@azure/msal-browser';

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
  async restore(preferredId?: string): Promise<AccountInfo | null> {
    const epoch = this.epoch;
    await this.initialize(); this.check(epoch);
    const account = this.find(preferredId); if (!account) return null;
    await this.auth.acquireTokenSilent({ scopes, account }); this.check(epoch, account.homeAccountId);
    this.select(account); return account;
  }
  async connect(switchAccount = false): Promise<AccountInfo> {
    if (this.connecting) return this.connecting;
    const epoch = this.epoch;
    const task = async () => {
      await this.initialize(); this.check(epoch);
      if (!switchAccount) {
        const account = this.find();
        if (account) {
          try { await this.auth.acquireTokenSilent({ scopes, account }); }
          catch (error) {
            if (!(error instanceof InteractionRequiredAuthError)) throw error;
            await this.popupToken(account, epoch);
          }
          this.check(epoch, account.homeAccountId); this.select(account); return account;
        }
      }
      const result = await this.auth.loginPopup({ scopes, prompt: 'select_account' });
      this.check(epoch);
      if (!result.account) throw new Error('Microsoft 登录未返回账户');
      this.epoch += 1; this.select(result.account); return result.account;
    };
    this.connecting = task();
    try { return await this.connecting; } finally { this.connecting = undefined; }
  }
  private async popupToken(account: AccountInfo, epoch: number): Promise<string> {
    if (!this.refreshing) {
      this.refreshing = (async () => {
        const result = await this.auth.acquireTokenPopup({ scopes, account });
        this.check(epoch, account.homeAccountId);
        if (result.account && result.account.homeAccountId !== account.homeAccountId) throw new Error('授权账户与当前文件账户不一致，请使用「切换账户」重新连接');
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
    try { token = (await this.auth.acquireTokenSilent({ scopes, account })).accessToken; }
    catch (error) {
      if (!(error instanceof InteractionRequiredAuthError)) throw error;
      if (!interactive) throw new Error('Microsoft 登录已过期，请点击连接或同步按钮重新授权');
      token = await this.popupToken(account, epoch);
    }
    this.check(epoch, accountId); return token;
  }
  async disconnect(expectedId?: string): Promise<void> {
    await this.initialize(); this.check(this.epoch, expectedId);
    const account = this.find(); this.epoch += 1;
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
    const auth = new PublicClientApplication({ auth: { clientId: id, authority: 'https://login.microsoftonline.com/common', redirectUri: `${window.location.origin}${window.location.pathname}` }, cache: { cacheLocation: 'sessionStorage' } });
    session = new OneDriveSession(id, auth, window.sessionStorage); sessions.set(id, session);
  }
  return session;
}
