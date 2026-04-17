// One-time startup migration: readest namespace → hermes namespace.
// Guard key: 'hermes:migration' = 'v1done' prevents re-running.

const MIGRATION_GUARD_KEY = 'hermes:migration';
const MIGRATION_DONE_VALUE = 'v1done';
const LEGACY_IDB_NAME = 'readest-ai';
const HERMES_IDB_NAME = 'hermes-ai';
const HERMES_IDB_VERSION = 6;
const IDB_STORES = [
  'chunks',
  'bookMeta',
  'bm25Indices',
  'conversations',
  'messages',
  'vocabulary',
  'bookSeries',
  'dictionaryData',
] as const;

function migrateLocalStorage(): void {
  const keys = Object.keys(localStorage);
  for (const key of keys) {
    const newKey = key.startsWith('readest:')
      ? `hermes:${key.slice('readest:'.length)}`
      : key.startsWith('readest_')
        ? `hermes_${key.slice('readest_'.length)}`
        : null;
    // Only migrate if the target key doesn't already exist
    if (!newKey || localStorage.getItem(newKey) !== null) continue;
    const value = localStorage.getItem(key);
    if (value !== null) {
      localStorage.setItem(newKey, value);
      localStorage.removeItem(key);
    }
  }
}

async function openDB(name: string, version?: number): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const req = version !== undefined ? indexedDB.open(name, version) : indexedDB.open(name);
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
    req.onupgradeneeded = () => {
      // Create missing stores in target DB using simple keyPaths matching aiStore schema
      const db = req.result;
      const storeKeyPaths: Record<string, string | null> = {
        chunks: 'id',
        bookMeta: 'bookHash',
        bm25Indices: 'bookHash',
        conversations: 'id',
        messages: 'id',
        vocabulary: 'id',
        bookSeries: 'id',
        dictionaryData: 'id',
      };
      for (const store of IDB_STORES) {
        if (!db.objectStoreNames.contains(store)) {
          const keyPath = storeKeyPaths[store];
          if (keyPath) {
            db.createObjectStore(store, { keyPath });
          } else {
            db.createObjectStore(store);
          }
        }
      }
    };
  });
}

async function migrateIDB(): Promise<void> {
  if (typeof indexedDB === 'undefined') return;
  // indexedDB.databases() is not available in all browsers (e.g. Firefox ≤126)
  if (typeof indexedDB.databases !== 'function') return;

  const dbs = await indexedDB.databases();
  const hasLegacy = dbs.some((db) => db.name === LEGACY_IDB_NAME);
  if (!hasLegacy) return;

  let srcDb: IDBDatabase;
  let dstDb: IDBDatabase;
  try {
    srcDb = await openDB(LEGACY_IDB_NAME);
    dstDb = await openDB(HERMES_IDB_NAME, HERMES_IDB_VERSION);
  } catch (err) {
    console.warn('[hermesMigration] Could not open IDB for migration:', err);
    return;
  }

  try {
    for (const storeName of IDB_STORES) {
      if (!srcDb.objectStoreNames.contains(storeName)) continue;
      if (!dstDb.objectStoreNames.contains(storeName)) continue;

      const records: unknown[] = await new Promise((resolve, reject) => {
        const tx = srcDb.transaction(storeName, 'readonly');
        const req = tx.objectStore(storeName).getAll();
        req.onsuccess = () => resolve(req.result as unknown[]);
        req.onerror = () => reject(req.error);
      });

      if (records.length === 0) continue;

      await new Promise<void>((resolve, reject) => {
        const tx = dstDb.transaction(storeName, 'readwrite');
        const store = tx.objectStore(storeName);
        for (const record of records) {
          store.put(record);
        }
        tx.oncomplete = () => resolve();
        tx.onerror = () => reject(tx.error);
      });
    }
  } finally {
    srcDb.close();
    dstDb.close();
  }

  // Best-effort cleanup; non-fatal if it fails
  try {
    indexedDB.deleteDatabase(LEGACY_IDB_NAME);
  } catch {
    // ignore
  }
}

export async function runHermesMigration(): Promise<void> {
  if (typeof localStorage === 'undefined') return;
  if (localStorage.getItem(MIGRATION_GUARD_KEY) === MIGRATION_DONE_VALUE) return;

  try {
    migrateLocalStorage();
    await migrateIDB();
    localStorage.setItem(MIGRATION_GUARD_KEY, MIGRATION_DONE_VALUE);
  } catch (err) {
    console.warn('[hermesMigration] Migration failed, continuing with fresh state:', err);
  }
}
