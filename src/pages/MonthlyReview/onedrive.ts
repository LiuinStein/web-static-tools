import { ResponseType } from '@microsoft/microsoft-graph-client';
import { OneDriveConnection } from '../../services/onedrive-connection';

export interface DriveFile { id: string; name: string; eTag: string; size: number; webUrl?: string; }
export const normalizeFolder = (value: string): string => {
  const folder = value.trim().replace(/^\/+|\/+$/g, '');
  if (!folder || folder.split('/').some(p => !p || p === '.' || p === '..' || /[\\:*?"<>|]/.test(p))) throw new Error('请输入有效的 OneDrive 文件夹路径');
  return folder;
};
export class MonthlyDrive extends OneDriveConnection {
  folder: string;
  private fileList?: { scope: string; files: DriveFile[] };
  private downloads = new Map<string, { scope: string; file: DriveFile; data: ArrayBuffer }>();
  private listing?: Promise<DriveFile[]>;
  protected identityChanged() { this.fileList = undefined; this.listing = undefined; this.downloads?.clear(); }
  cachedFiles(): DriveFile[] {
    return this.currentAccount() && this.fileList?.scope === this.cacheScope() ? this.fileList.files.map(file => ({ ...file })) : [];
  }
  constructor(clientId: string, folder: string) { const clean = normalizeFolder(folder); super({ clientId, path: `${clean}/monthly.xlsx` }); this.folder = clean; }
  private folderEndpoint() { return `/me/drive/root:/${this.folder.split('/').map(encodeURIComponent).join('/')}`; }
  async list(): Promise<DriveFile[]> {
    if (this.listing) return this.listing;
    const scope = this.cacheScope();
    const task = this.operation(false, () => this.listFiles()).then(files => {
      this.assertScope(scope);
      this.fileList = { scope, files: files.map(file => ({ ...file })) }; return files;
    });
    this.listing = task;
    try { return (await task).map(file => ({ ...file })); } finally { if (this.listing === task) this.listing = undefined; }
  }
  private async listFiles(): Promise<DriveFile[]> {
    let url = `${this.folderEndpoint()}:/children`; const files: DriveFile[] = [];
    try {
      while (url) { const page = await this.client.api(url).get(); files.push(...page.value.filter((f: any) => f.file && /\.xlsx$/i.test(f.name))); url = page['@odata.nextLink']; }
      return files.sort((a, b) => b.name.localeCompare(a.name));
    } catch (e) { if (e.statusCode === 404) return []; throw e; }
  }
  async download(file: DriveFile): Promise<{ data: ArrayBuffer; file: DriveFile }> {
    return this.operation(true, () => this.downloadFile(file));
  }
  private async downloadFile(file: DriveFile): Promise<{ data: ArrayBuffer; file: DriveFile }> {
    const scope = this.cacheScope();
    const current = await this.client.api(`/me/drive/items/${file.id}`).select('id,name,eTag,size,webUrl').get();
    if (current.size > 10 * 1024 * 1024) throw new Error('文件超过 10MB');
    this.assertScope(scope);
    const cached = this.downloads.get(file.id);
    if (current.eTag && cached?.scope === scope && cached.file.eTag === current.eTag) return { data: cached.data.slice(0), file: { ...current } };
    this.downloads.delete(file.id);
    const data = await this.client.api(`/me/drive/items/${file.id}/content`).responseType(ResponseType.ARRAYBUFFER).get();
    const after = await this.client.api(`/me/drive/items/${file.id}`).select('eTag').get();
    if (after.eTag !== current.eTag) throw new Error('文件在读取期间发生变化，请重新打开');
    this.assertScope(scope);
    if (current.eTag) {
      if (this.downloads.size >= 4) this.downloads.delete(this.downloads.keys().next().value!);
      this.downloads.set(file.id, { scope, file: { ...current }, data: data.slice(0) });
    }
    return { data, file: current };
  }
  private async ensureFolder() {
    let parent = '/me/drive/root';
    for (const name of this.folder.split('/')) {
      let item;
      try { item = await this.client.api(`${parent}:/${encodeURIComponent(name)}`).get(); }
      catch (error) {
        if (error.statusCode !== 404) throw error;
        try { item = await this.client.api(`${parent}/children`).post({ name, folder: {}, '@microsoft.graph.conflictBehavior': 'fail' }); }
        catch (e) { if (e.statusCode !== 409) throw e; item = await this.client.api(`${parent}:/${encodeURIComponent(name)}`).get(); }
      }
      if (!item.folder) throw new Error('目标路径包含同名文件'); parent = `/me/drive/items/${item.id}`;
    }
  }
  async publish(name: string, data: Uint8Array, baseline?: DriveFile): Promise<DriveFile> {
    return this.operation(true, () => this.publishFile(name, data, baseline));
  }
  private async publishFile(name: string, data: Uint8Array, baseline?: DriveFile): Promise<DriveFile> {
    if (!/^[^/\\:*?"<>|]+\.xlsx$/i.test(name)) throw new Error('文件名无效');
    this.fileList = undefined;
    this.downloads?.clear();
    if (baseline) {
      const current = await this.client.api(`/me/drive/items/${baseline.id}`).select('eTag').get();
      if (!baseline.eTag || !current.eTag || current.eTag !== baseline.eTag) throw new Error('云端文件已修改。请先下载本机副本，再重新打开云端文件核对；本次未覆盖。');
      return this.client.api(`/me/drive/items/${baseline.id}/content`).header('If-Match', baseline.eTag).header('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet').put(data);
    }
    await this.ensureFolder();
    return this.client.api(`${this.folderEndpoint()}/${encodeURIComponent(name)}:/content`).query({ '@microsoft.graph.conflictBehavior': 'fail' }).header('If-None-Match', '*').header('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet').put(data);
  }
}

const monthlyDrives = new Map<string, MonthlyDrive>();
export function monthlyDrive(clientId: string, folder: string): MonthlyDrive {
  const key = JSON.stringify([clientId.trim().toLowerCase(), normalizeFolder(folder)]);
  let service = monthlyDrives.get(key);
  if (!service) { service = new MonthlyDrive(clientId, folder); monthlyDrives.set(key, service); }
  return service;
}
