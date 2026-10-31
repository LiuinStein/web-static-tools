import { PublicClientApplication, InteractionRequiredAuthError, AccountInfo } from '@azure/msal-browser';
import { Client, ResponseType } from '@microsoft/microsoft-graph-client';
import { Trade, TradeChange, mergeForSync } from './model';
import { readWorkbook, writeWorkbook } from './workbook';

export interface DriveConfig {
  clientId: string;
  path: string;
}
const scopes = ['Files.ReadWrite'];
export function normalizePath(path: string): string {
  const clean = path.trim().replace(/^\/+|\/+$/g, '');
  if (
    !clean ||
    !clean.toLowerCase().endsWith('.xlsx') ||
    clean.split('/').some((part) => !part || part === '.' || part === '..' || /[\\:*?"<>|]/.test(part))
  ) {
    throw new Error('请输入有效的 .xlsx 文件路径，例如 文档/BalanceSheet/TradingJournal.xlsx');
  }
  return clean;
}
export class OneDriveJournal {
  private auth: PublicClientApplication;
  private client: Client;
  private account: AccountInfo;
  readonly config: DriveConfig;
  constructor(config: DriveConfig) {
    if (!/^[0-9a-f-]{36}$/i.test(config.clientId.trim())) throw new Error('请输入 Microsoft 应用的客户端 ID');
    this.config = { clientId: config.clientId.trim(), path: normalizePath(config.path) };
    this.auth = new PublicClientApplication({
      auth: {
        clientId: this.config.clientId,
        authority: 'https://login.microsoftonline.com/common',
        redirectUri: `${window.location.origin}${window.location.pathname}`,
      },
      cache: { cacheLocation: 'sessionStorage' },
    });
    this.client = Client.initWithMiddleware({
      authProvider: {
        getAccessToken: async () => {
          let result;
          try {
            result = await this.auth.acquireTokenSilent({ scopes, account: this.account });
          } catch (error) {
            if (!(error instanceof InteractionRequiredAuthError)) throw error;
            result = await this.auth.acquireTokenPopup({ scopes, account: this.account });
          }
          return result.accessToken;
        },
      },
    });
  }
  async restore(accountId: string): Promise<AccountInfo | null> {
    await this.auth.initialize();
    const account = this.auth.getAllAccounts().find((item) => item.homeAccountId === accountId);
    if (!account) return null;
    this.account = account;
    await this.auth.acquireTokenSilent({ scopes, account });
    return account;
  }
  async connect(): Promise<AccountInfo> {
    await this.auth.initialize();
    const result = await this.auth.loginPopup({ scopes, prompt: 'select_account' });
    if (!result.account) throw new Error('Microsoft 登录未返回账户');
    this.account = result.account;
    return this.account;
  }
  async disconnect(): Promise<void> {
    await this.auth.clearCache({ account: this.account });
  }
  private endpoint(): string {
    return `/me/drive/root:/${this.config.path.split('/').map(encodeURIComponent).join('/')}`;
  }
  private async load() {
    let item;
    try {
      item = await this.client.api(this.endpoint()).select('id,eTag,size').get();
    } catch (error) {
      if (error.statusCode === 404 || error.code === 'itemNotFound') return { ...(await readWorkbook()), item: null };
      throw error;
    }
    if (item.size > 10 * 1024 * 1024) throw new Error('Excel 超过 10MB，请先归档旧记录后重试');
    const data = await this.client
      .api(`/me/drive/items/${item.id}/content`)
      .responseType(ResponseType.ARRAYBUFFER)
      .get();
    const latest = await this.client.api(`/me/drive/items/${item.id}`).select('eTag').get();
    if (latest.eTag !== item.eTag) throw new Error('文件正在被其他设备修改，请重新同步');
    return { ...(await readWorkbook(data)), item };
  }
  async read(): Promise<Trade[]> {
    return (await this.load()).trades;
  }
  private async ensureFolders(): Promise<void> {
    const parts = this.config.path.split('/').slice(0, -1);
    let parent = '/me/drive/root';
    for (const name of parts) {
      const path = `${parent}:/${encodeURIComponent(name)}`;
      let folder;
      try {
        folder = await this.client.api(path).select('id,folder').get();
      } catch (error) {
        if (error.statusCode !== 404) throw error;
        try {
          folder = await this.client
            .api(`${parent}/children`)
            .post({ name, folder: {}, '@microsoft.graph.conflictBehavior': 'fail' });
        } catch (createError) {
          if (createError.statusCode !== 409) throw createError;
          folder = await this.client.api(path).select('id,folder').get();
        }
      }
      if (!folder.folder) throw new Error(`目标路径“${name}”不是目录`);
      parent = `/me/drive/items/${folder.id}`;
    }
  }
  async sync(pending: Trade[], changes: TradeChange[] = []): Promise<Trade[]> {
    for (let attempt = 0; attempt < 3; attempt += 1) {
      const { workbook, trades, item } = await this.load();
      const merged = mergeForSync(trades, pending, changes);
      if (!pending.length && !changes.length) return merged;
      const data = await writeWorkbook(workbook, merged);
      try {
        if (item) {
          await this.client
            .api(`/me/drive/items/${item.id}/content`)
            .header('If-Match', item.eTag)
            .header('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet')
            .put(data);
        } else {
          await this.ensureFolders();
          await this.client
            .api(`${this.endpoint()}:/content`)
            .query({ '@microsoft.graph.conflictBehavior': 'fail' })
            .header('If-None-Match', '*')
            .header('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet')
            .put(data);
        }
        return merged;
      } catch (error) {
        if (![409, 412].includes(error.statusCode) || attempt === 2) throw error;
      }
    }
    throw new Error('云端文件发生冲突，请重试');
  }
}
