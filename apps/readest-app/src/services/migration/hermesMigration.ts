// One-time startup migration: readest namespace → hermes namespace.
// Guard key: 'hermes:migration' = 'v1done' prevents re-running after the relevant work has completed.

const MIGRATION_GUARD_KEY = 'hermes:migration';
const MIGRATION_DONE_VALUE = 'v1done';
const LEGACY_IDB_NAME = 'readest-ai';
const HERMES_IDB_NAME = 'hermes-ai';
const HERMES_IDB_VERSION = 8;
const IDB_STORES = [
  'chunks',
  'bookMeta',
  'conversations',
  'messages',
  'vocabulary',
  'bookSeries',
  'dictionaryData',
] as const;

let migrationPromise: Promise<void> | null = null;

function migrateLocalStorage(): void {
  const keys = Object.keys(localStorage);
  for (const key of keys) {
    const newKey = key.startsWith('readest:')
      ? `hermes:${key.slice('readest:'.length)}`
      : key.startsWith('readest_')
        ? `hermes_${key.slice('readest_'.length)}`
        : null;

    // Only migrate if the target key doesn't already exist.
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
      const db = req.result;
      if (db.objectStoreNames.contains('bm25Indices')) {
        db.deleteObjectStore('bm25Indices');
      }
      const upgradeTx = req.transaction!;
      const openOrCreateStore = (storeName: (typeof IDB_STORES)[number], keyPath: string) => {
        if (!db.objectStoreNames.contains(storeName)) {
          return db.createObjectStore(storeName, { keyPath });
        }
        return upgradeTx.objectStore(storeName);
      };
      const ensureIndex = (store: IDBObjectStore, indexName: string, keyPath: string) => {
        if (!store.indexNames.contains(indexName)) {
          store.createIndex(indexName, keyPath, { unique: false });
        }
      };

      openOrCreateStore('chunks', 'id');
      openOrCreateStore('bookMeta', 'bookHash');

      const conversationsStore = openOrCreateStore('conversations', 'id');
      ensureIndex(conversationsStore, 'bookHash', 'bookHash');

      const messagesStore = openOrCreateStore('messages', 'id');
      ensureIndex(messagesStore, 'conversationId', 'conversationId');

      const vocabularyStore = openOrCreateStore('vocabulary', 'id');
      ensureIndex(vocabularyStore, 'bookHash', 'bookHash');
      ensureIndex(vocabularyStore, 'term', 'term');
      ensureIndex(vocabularyStore, 'addedAt', 'addedAt');
      ensureIndex(vocabularyStore, 'dueAt', 'dueAt');

      openOrCreateStore('bookSeries', 'id');
      openOrCreateStore('dictionaryData', 'id');
    };
  });
}

function cleanupDatabase(name: string): Promise<void> {
  return new Promise((resolve) => {
    try {
      const request = indexedDB.deleteDatabase(name);
      request.onsuccess = () => resolve();
      request.onerror = () => resolve();
      request.onblocked = () => resolve();
    } catch {
      resolve();
    }
  });
}

async function probeLegacyDatabasePresence(): Promise<boolean> {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open(LEGACY_IDB_NAME);
    request.onerror = () => reject(request.error);
    request.onsuccess = () => {
      const db = request.result;
      const hasStores = db.objectStoreNames.length > 0;
      db.close();

      if (hasStores) {
        resolve(true);
        return;
      }

      void cleanupDatabase(LEGACY_IDB_NAME).then(() => resolve(false));
    };
  });
}

async function legacyDatabaseExists(): Promise<boolean> {
  if (typeof indexedDB === 'undefined') return false;
  if (typeof indexedDB.databases === 'function') {
    const dbs = await indexedDB.databases();
    return dbs.some((db) => db.name === LEGACY_IDB_NAME);
  }
  return probeLegacyDatabasePresence();
}

async function migrateIDB(): Promise<void> {
  if (typeof indexedDB === 'undefined') return;
  if (!(await legacyDatabaseExists())) return;

  let srcDb: IDBDatabase | undefined;
  let dstDb: IDBDatabase | undefined;

  try {
    srcDb = await openDB(LEGACY_IDB_NAME);
    dstDb = await openDB(HERMES_IDB_NAME, HERMES_IDB_VERSION);

    const src = srcDb;
    const dst = dstDb;
    if (!src || !dst) return;

    for (const storeName of IDB_STORES) {
      if (!src.objectStoreNames.contains(storeName)) continue;
      if (!dst.objectStoreNames.contains(storeName)) continue;

      const records: unknown[] = await new Promise((resolve, reject) => {
        const tx = src.transaction(storeName, 'readonly');
        const req = tx.objectStore(storeName).getAll();
        req.onsuccess = () => resolve(req.result as unknown[]);
        req.onerror = () => reject(req.error);
      });

      if (records.length === 0) continue;

      await new Promise<void>((resolve, reject) => {
        const tx = dst.transaction(storeName, 'readwrite');
        const store = tx.objectStore(storeName);
        for (const record of records) {
          store.put(record);
        }
        tx.oncomplete = () => resolve();
        tx.onerror = () => reject(tx.error);
      });
    }
  } finally {
    srcDb?.close();
    dstDb?.close();
  }

  await cleanupDatabase(LEGACY_IDB_NAME);
}

export async function runHermesMigration(): Promise<void> {
  if (typeof localStorage === 'undefined') return;
  if (localStorage.getItem(MIGRATION_GUARD_KEY) === MIGRATION_DONE_VALUE) return;

  if (migrationPromise) {
    await migrationPromise;
    return;
  }

  migrationPromise = (async () => {
    try {
      migrateLocalStorage();
      await migrateIDB();
    } catch (err) {
      console.warn('[hermesMigration] Migration failed, continuing with fresh state:', err);
    } finally {
      localStorage.setItem(MIGRATION_GUARD_KEY, MIGRATION_DONE_VALUE);
      migrationPromise = null;
    }
  })();

  await migrationPromise;
}
