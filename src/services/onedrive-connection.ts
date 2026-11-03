import type { AccountInfo } from '@azure/msal-browser';
import { Client } from '@microsoft/microsoft-graph-client';
import { OneDriveSession, oneDriveSession } from './onedrive-session';

export interface DriveConfig { clientId: string; path: string; }
export function normalizePath(path: string): string {
  const clean = path.trim().replace(/^\/+|\/+$/g, '');
  if (!clean || !clean.toLowerCase().endsWith('.xlsx') || clean.split('/').some(part => !part || part === '.' || part === '..' || /[\\:*?"<>|]/.test(part))) {
    throw new Error('请输入有效的 .xlsx 文件路径，例如 文档/BalanceSheet/TradingJournal.xlsx');
  }
  return clean;
}

// File transport and identity only: never import a workbook implementation here.
export class OneDriveConnection {
  protected session: OneDriveSession;
  protected client: Client;
  protected account: AccountInfo;
  protected allowInteractiveAuth = false;
  private operations?: Promise<unknown>;
  private generation?: number;
  readonly config: DriveConfig;
  constructor(config: DriveConfig) {
    this.config = { clientId: config.clientId.trim().toLowerCase(), path: normalizePath(config.path) };
    this.session = oneDriveSession(this.config.clientId);
    this.client = Client.initWithMiddleware({ authProvider: { getAccessToken: () => this.accessToken() } });
  }
  protected async accessToken(): Promise<string> {
    if (!this.account) throw new Error('请先连接 OneDrive');
    this.assertScope(this.cacheScope());
    return this.session.token(this.account.homeAccountId, this.allowInteractiveAuth);
  }
  currentAccount(): AccountInfo | null {
    const current = this.session.currentAccount();
    return current && this.account?.homeAccountId === current.homeAccountId && this.generation === this.session.revision ? current : null;
  }
  protected cacheScope(): string {
    return JSON.stringify([this.config?.clientId, this.account?.homeAccountId, this.generation, this.config?.path]);
  }
  protected assertScope(scope: string) {
    // Detached transports can provide their own authenticated client.
    if (!this.session) return;
    if (scope !== this.cacheScope() || !this.currentAccount()) throw new Error('OneDrive 账户或登录状态已变化，请重新连接当前页面');
  }
  protected async operation<T>(interactive: boolean, action: () => Promise<T>): Promise<T> {
    const scope = this.cacheScope();
    const task = (this.operations || Promise.resolve()).catch(() => {}).then(async () => {
      this.assertScope(scope); this.allowInteractiveAuth = interactive;
      try { const result = await action(); this.assertScope(scope); return result; }
      finally { this.allowInteractiveAuth = false; }
    });
    this.operations = task; return task;
  }
  protected identityChanged() {}
  private bind(account: AccountInfo) {
    if (this.account?.homeAccountId !== account.homeAccountId || this.generation !== this.session.revision) this.identityChanged();
    this.account = account; this.generation = this.session.revision;
  }
  async restore(accountId?: string): Promise<AccountInfo | null> {
    const account = await this.session.restore(accountId);
    if (!account) { this.identityChanged(); return null; }
    this.bind(account); return account;
  }
  async connect(switchAccount = false): Promise<AccountInfo> {
    const account = await this.session.connect(switchAccount);
    this.bind(account); return account;
  }
  async disconnect(): Promise<void> {
    this.identityChanged();
    await this.session.disconnect(this.account?.homeAccountId);
  }
}
