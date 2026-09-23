/**
 * 本地库：现场记录先落这里，回到有网再同步（F10）。
 *
 * 不引依赖，直接用 IndexedDB——离线优先是现场端的主场（技术方案 2.3）。
 * 记录的 id 由客户端生成：离线创建的记录也要能稳定引用清单条目。
 */

import type { ChecklistView } from '@zx/contracts';

const DB_NAME = 'zx-onsite';
const DB_VERSION = 1;
const RECORDS = 'records';
const CHECKLISTS = 'checklists';
const META = 'meta';

export interface LocalRecord {
  id: string;
  demandSheetId: string;
  checklistId: string;
  itemKey: string;
  status: 'asked' | 'skip';
  note: string;
  at: string;
  synced: boolean;
}

export interface CachedChecklist {
  id: string;
  demandSheetId: string;
  demandName: string;
  overview: string;
  submittedAt: string;
  checklist: ChecklistView;
  /** 清单引用到的字段取值：现场对照「房主原来填的」 */
  fieldValues: Record<string, { label: string; value: string }>;
  cachedAt: string;
}

function open(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open(DB_NAME, DB_VERSION);
    request.onupgradeneeded = () => {
      const db = request.result;
      if (!db.objectStoreNames.contains(RECORDS)) db.createObjectStore(RECORDS, { keyPath: 'id' });
      if (!db.objectStoreNames.contains(CHECKLISTS)) db.createObjectStore(CHECKLISTS, { keyPath: 'id' });
      if (!db.objectStoreNames.contains(META)) db.createObjectStore(META, { keyPath: 'key' });
    };
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
}

function tx<T>(store: string, mode: IDBTransactionMode, run: (s: IDBObjectStore) => IDBRequest): Promise<T> {
  return open().then(
    (db) =>
      new Promise<T>((resolve, reject) => {
        const transaction = db.transaction(store, mode);
        const request = run(transaction.objectStore(store));
        request.onsuccess = () => resolve(request.result as T);
        request.onerror = () => reject(request.error);
        transaction.oncomplete = () => db.close();
      }),
  );
}

export function putRecord(record: LocalRecord): Promise<IDBValidKey> {
  return tx(RECORDS, 'readwrite', (s) => s.put(record));
}

export function allRecords(): Promise<LocalRecord[]> {
  return tx<LocalRecord[]>(RECORDS, 'readonly', (s) => s.getAll());
}

export function deleteRecord(id: string): Promise<void> {
  return tx(RECORDS, 'readwrite', (s) => s.delete(id)).then(() => undefined);
}

export function markSynced(ids: string[]): Promise<void> {
  return open().then(
    (db) =>
      new Promise<void>((resolve, reject) => {
        const transaction = db.transaction(RECORDS, 'readwrite');
        const store = transaction.objectStore(RECORDS);
        ids.forEach((id) => {
          const get = store.get(id);
          get.onsuccess = () => {
            const value = get.result as LocalRecord | undefined;
            if (value) store.put({ ...value, synced: true });
          };
        });
        transaction.oncomplete = () => {
          db.close();
          resolve();
        };
        transaction.onerror = () => reject(transaction.error);
      }),
  );
}

export function cacheChecklist(value: CachedChecklist): Promise<IDBValidKey> {
  return tx(CHECKLISTS, 'readwrite', (s) => s.put(value));
}

export function cachedChecklists(): Promise<CachedChecklist[]> {
  return tx<CachedChecklist[]>(CHECKLISTS, 'readonly', (s) => s.getAll());
}

export function cachedChecklist(id: string): Promise<CachedChecklist | undefined> {
  return tx<CachedChecklist | undefined>(CHECKLISTS, 'readonly', (s) => s.get(id));
}

export function setMeta(key: string, value: unknown): Promise<IDBValidKey> {
  return tx(META, 'readwrite', (s) => s.put({ key, value }));
}

export function getMeta<T>(key: string): Promise<T | undefined> {
  return tx<{ key: string; value: T } | undefined>(META, 'readonly', (s) => s.get(key)).then((row) => row?.value);
}

