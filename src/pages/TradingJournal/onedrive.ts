import { ResponseType } from '@microsoft/microsoft-graph-client';
import { OneDriveConnection, normalizePath } from '../../services/onedrive-connection';
import type { DriveConfig } from '../../services/onedrive-connection';
import { Trade, TradeChange, mergeForSync } from './model';
import { readWorkbook, writeWorkbook } from './workbook';
export { normalizePath } from '../../services/onedrive-connection';
export type { DriveConfig } from '../../services/onedrive-connection';

interface RemoteFile { id: string; eTag?: string; size?: number; }

export class OneDriveJournal extends OneDriveConnection {
  private cachedRead?: { id: string; eTag: string; trades: Trade[]; scope: string };
  protected identityChanged() { this.cachedRead = undefined; }
  cachedTrades(): Trade[] | null {
    return this.currentAccount() && this.cachedRead?.scope === this.cacheScope()
      ? this.cachedRead.trades.map(trade => ({ ...trade })) : null;
  }
  private endpoint(): string {
    return `/me/drive/root:/${this.config.path.split('/').map(encodeURIComponent).join('/')}`;
  }
  private remember(item: RemoteFile | null | undefined, trades: Trade[]): void {
    this.cachedRead = item && item.id && item.eTag
      ? { id: item.id, eTag: item.eTag, scope: this.cacheScope(), trades: trades.map((trade) => ({ ...trade })) }
      : undefined;
  }
  private async metadata(): Promise<RemoteFile | null> {
    let item: RemoteFile;
    try {
      item = await this.client.api(this.endpoint()).select('id,eTag,size').get();
    } catch (error) {
      if (error.statusCode === 404 || error.code === 'itemNotFound') {
        this.cachedRead = undefined;
        return null;
      }
      throw error;
    }
    if ((item.size || 0) > 10 * 1024 * 1024) throw new Error('Excel 超过 10MB，请先归档旧记录后重试');
    return item;
  }
  private async load(knownItem?: RemoteFile | null) {
    const scope = this.cacheScope();
    const item = knownItem === undefined ? await this.metadata() : knownItem;
    if (!item) return { ...(await readWorkbook()), item: null };
    const data = await this.client
      .api(`/me/drive/items/${item.id}/content`)
      .responseType(ResponseType.ARRAYBUFFER)
      .get();
    const latest = await this.client.api(`/me/drive/items/${item.id}`).select('eTag').get();
    if (latest.eTag !== item.eTag) throw new Error('文件正在被其他设备修改，请重新同步');
    const result = await readWorkbook(data);
    this.assertScope(scope);
    this.remember(item, result.trades);
    return { ...result, item };
  }
  async read(): Promise<Trade[]> { return this.sync([], [], false); }
  private async readVerified(): Promise<Trade[]> {
    const item = await this.metadata();
    const cached = this.cachedRead;
    if (item && item.eTag && cached && cached.scope === this.cacheScope() && cached.id === item.id && cached.eTag === item.eTag) {
      return cached.trades.map((trade) => ({ ...trade }));
    }
    if (!item) return [];
    return (await this.load(item)).trades;
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
  async sync(pending: Trade[], changes: TradeChange[] = [], interactive = true): Promise<Trade[]> {
    return this.operation(interactive, () => this.syncWorkbook(pending, changes));
  }
  private async syncWorkbook(pending: Trade[], changes: TradeChange[]): Promise<Trade[]> {
    const scope = this.cacheScope();
    if (!pending.length && !changes.length) return this.readVerified();
    for (let attempt = 0; attempt < 3; attempt += 1) {
      const { workbook, trades, item } = await this.load();
      const merged = mergeForSync(trades, pending, changes);
      const data = await writeWorkbook(workbook, merged);
      try {
        // A failed/ambiguous upload must never leave an old version cached as current.
        this.cachedRead = undefined;
        let uploaded: RemoteFile | undefined;
        if (item) {
          if (!item.eTag) throw new Error('无法读取云端文件版本，请重新同步');
          uploaded = await this.client
            .api(`/me/drive/items/${item.id}/content`)
            .header('If-Match', item.eTag)
            .header('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet')
            .put(data);
        } else {
          await this.ensureFolders();
          uploaded = await this.client
            .api(`${this.endpoint()}:/content`)
            .query({ '@microsoft.graph.conflictBehavior': 'fail' })
            .header('If-None-Match', '*')
            .header('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet')
            .put(data);
        }
        // Graph returns the saved file's version. Without it, verify via a fresh read next time.
        this.assertScope(scope);
        this.remember(uploaded, merged);
        return merged;
      } catch (error) {
        if (![409, 412].includes(error.statusCode) || attempt === 2) throw error;
      }
    }
    throw new Error('云端文件发生冲突，请重试');
  }
}

const journals = new Map<string, OneDriveJournal>();
export function journalDrive(config: DriveConfig): OneDriveJournal {
  const key = JSON.stringify([config.clientId.trim().toLowerCase(), normalizePath(config.path)]);
  let service = journals.get(key);
  if (!service) { service = new OneDriveJournal(config); journals.set(key, service); }
  return service;
}
