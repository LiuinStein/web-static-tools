import type { DriveFile } from './onedrive';

export interface Draft { id: string; name: string; data: Uint8Array; updated: string; source?: DriveFile; scope?: string; sourceLabel?: string; published?: string; }

function cloudLocation(draft: Draft) {
  if (!draft.scope) return null;
  const [client, account, ...parts] = draft.scope.split(':');
  return client && account && parts.length ? { account, folder: parts.join(':').replace(/^\/+|\/+$/g, '') } : null;
}
export function draftIdentity(draft: Draft): string {
  const location = cloudLocation(draft);
  // The authentication application can change while the account and file location stay the same.
  if (location) return JSON.stringify(['onedrive', location.account, location.folder.toLowerCase(), draft.name.toLowerCase()]);
  if (draft.scope) return JSON.stringify(['onedrive-scope', draft.scope, draft.name]);
  if (draft.source?.id) return JSON.stringify(['onedrive-file', draft.source.id, draft.name]);
  return JSON.stringify(['local', draft.name]);
}
function isCloud(draft: Draft) { return Boolean(draft.scope || draft.source?.id); }
function newestFirst(a: Draft, b: Draft) { return b.updated.localeCompare(a.updated) || b.id.localeCompare(a.id); }
export function uniqueDrafts(drafts: Draft[]): Draft[] {
  const byIdentity = new Map<string, Draft>();
  for (const draft of [...drafts].sort(newestFirst)) if (!byIdentity.has(draftIdentity(draft))) byIdentity.set(draftIdentity(draft), draft);
  return [...byIdentity.values()];
}
export function draftSourceTitle(draft: Draft): string {
  const location = cloudLocation(draft);
  if (!isCloud(draft)) return '本地';
  return draft.sourceLabel || (location ? `账户 ${location.account} · /${location.folder}/` : 'OneDrive');
}
export function draftOptionLabel(draft: Draft, drafts: Draft[]): string {
  if (!isCloud(draft)) return `${draft.name} · 本地`;
  const ambiguous = drafts.some(other => other.id !== draft.id && isCloud(other) && other.name.toLowerCase() === draft.name.toLowerCase() && draftIdentity(other) !== draftIdentity(draft));
  return `${draft.name} · OneDrive${ambiguous ? `（${draftSourceTitle(draft)}）` : ''}`;
}

function database(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open('shaoqun-monthly-review', 1);
    req.onupgradeneeded = () => req.result.createObjectStore('drafts', { keyPath: 'id' });
    req.onsuccess = () => resolve(req.result); req.onerror = () => reject(req.error);
  });
}

// Match and replace in one transaction so concurrent imports cannot create duplicates.
// The returned ID is the stored ID, keeping the dropdown selection consistent.
export async function saveDraft(draft: Draft): Promise<Draft> {
  const db = await database();
  try {
    return await new Promise<Draft>((resolve, reject) => {
      const tx = db.transaction('drafts', 'readwrite'), store = tx.objectStore('drafts');
      let saved = draft;
      const request = store.getAll();
      request.onsuccess = () => {
        const current = request.result as Draft[];
        const matches = current.filter(row => draftIdentity(row) === draftIdentity(draft)).sort(newestFirst);
        const own = matches.find(row => row.id === draft.id);
        saved = { ...draft, id: own?.id || matches[0]?.id || draft.id };
        store.put(saved);
        for (const row of current) if (row.id !== saved.id && (draftIdentity(row) === draftIdentity(saved) || row.id === draft.id)) store.delete(row.id);
      };
      tx.oncomplete = () => resolve(saved);
      tx.onerror = () => reject(tx.error || new Error('保存草稿失败'));
      tx.onabort = () => reject(tx.error || new Error('保存草稿失败'));
    });
  } finally { db.close(); }
}

// Consolidate older duplicate cache entries as well, retaining the most recently saved copy.
export async function listDrafts(): Promise<Draft[]> {
  const db = await database();
  try {
    return await new Promise<Draft[]>((resolve, reject) => {
      const tx = db.transaction('drafts', 'readwrite'), store = tx.objectStore('drafts');
      let drafts: Draft[] = [];
      const request = store.getAll();
      request.onsuccess = () => {
        const current = request.result as Draft[]; drafts = uniqueDrafts(current);
        const ids = new Set(drafts.map(draft => draft.id));
        for (const row of current) if (!ids.has(row.id)) store.delete(row.id);
      };
      tx.oncomplete = () => resolve(drafts);
      tx.onerror = () => reject(tx.error || new Error('读取草稿失败'));
      tx.onabort = () => reject(tx.error || new Error('整理草稿失败'));
    });
  } finally { db.close(); }
}
