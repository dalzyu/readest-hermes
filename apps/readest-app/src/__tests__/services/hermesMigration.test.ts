import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { runHermesMigration } from '@/services/migration/hermesMigration';

type SeedRecord = Record<string, unknown>;

type SeedStore = {
  keyPath: string;
  records?: SeedRecord[];
};

type SeedDatabase = {
  version: number;
  stores?: Record<string, SeedStore>;
};

type DbState = {
  version: number;
  stores: Map<string, StoreState>;
};

type StoreState = {
  keyPath: string;
  records: Map<string, SeedRecord>;
  indexes: Set<string>;
};

type StringListLike = {
  contains: (value: string) => boolean;
  length: number;
};

type IndexedDbMock = {
  factory: IDBFactory;
  open: ReturnType<typeof vi.fn>;
  deleteDatabase: ReturnType<typeof vi.fn>;
  databases?: ReturnType<typeof vi.fn>;
  seedDatabase: (name: string, seed: SeedDatabase) => void;
  hasDatabase: (name: string) => boolean;
  getRecords: (name: string, storeName: string) => SeedRecord[];
};

function createStringList(values: Iterable<string>): StringListLike {
  const set = new Set(values);
  return {
    contains: (value: string) => set.has(value),
    get length() {
      return set.size;
    },
  };
}

function cloneRecord(record: SeedRecord): SeedRecord {
  return typeof structuredClone === 'function' ? structuredClone(record) : { ...record };
}

function createIndexedDbMock({
  includeDatabases = true,
}: { includeDatabases?: boolean } = {}): IndexedDbMock {
  const states = new Map<string, DbState>();

  const getStoreState = (dbName: string, storeName: string): StoreState => {
    const state = states.get(dbName);
    if (!state) throw new Error(`Database ${dbName} was not seeded`);
    const store = state.stores.get(storeName);
    if (!store) throw new Error(`Store ${storeName} was not seeded in ${dbName}`);
    return store;
  };

  const createStoreView = (dbName: string, storeName: string, onWriteComplete?: () => void) => {
    const state = getStoreState(dbName, storeName);
    return {
      get indexNames() {
        return createStringList(state.indexes);
      },
      createIndex: (indexName: string) => {
        state.indexes.add(indexName);
      },
      getAll: () => {
        const request = {
          result: [] as SeedRecord[],
          onsuccess: null as ((event: Event) => void) | null,
          onerror: null as ((event: Event) => void) | null,
        };

        queueMicrotask(() => {
          request.result = Array.from(state.records.values()).map((record) => cloneRecord(record));
          request.onsuccess?.(new Event('success'));
        });

        return request;
      },
      put: (record: SeedRecord) => {
        const key = String(record[state.keyPath]);
        state.records.set(key, cloneRecord(record));
        onWriteComplete?.();
        return { onsuccess: null, onerror: null };
      },
    };
  };

  const createDatabaseView = (dbName: string) => {
    const state = states.get(dbName);
    if (!state) throw new Error(`Database ${dbName} was not seeded`);

    return {
      get objectStoreNames() {
        return createStringList(state.stores.keys());
      },
      createObjectStore: (storeName: string, options: { keyPath: string }) => {
        let store = state.stores.get(storeName);
        if (!store) {
          store = {
            keyPath: options.keyPath,
            records: new Map(),
            indexes: new Set(),
          };
          state.stores.set(storeName, store);
        }
        return createStoreView(dbName, storeName);
      },
      deleteObjectStore: (storeName: string) => {
        state.stores.delete(storeName);
      },
      transaction: (storeName: string, mode: IDBTransactionMode = 'readonly') => {
        let completionScheduled = false;
        const transaction = {
          oncomplete: null as ((event: Event) => void) | null,
          onerror: null as ((event: Event) => void) | null,
          objectStore: (requestedStoreName: string) => {
            if (requestedStoreName !== storeName) {
              throw new Error(
                `Unexpected store ${requestedStoreName} in transaction for ${storeName}`,
              );
            }
            const scheduleComplete =
              mode === 'readwrite'
                ? () => {
                    if (completionScheduled) return;
                    completionScheduled = true;
                    queueMicrotask(() => {
                      transaction.oncomplete?.(new Event('complete'));
                    });
                  }
                : undefined;
            return createStoreView(dbName, storeName, scheduleComplete);
          },
        };
        return transaction;
      },
      close: () => {},
    };
  };

  const open = vi.fn((name: string, version?: number) => {
    const request: {
      result: ReturnType<typeof createDatabaseView> | null;
      error: DOMException | null;
      transaction: {
        objectStore: (storeName: string) => ReturnType<typeof createStoreView>;
      } | null;
      onsuccess: ((event: Event) => void) | null;
      onerror: ((event: Event) => void) | null;
      onupgradeneeded: ((event: Event) => void) | null;
    } = {
      result: null,
      error: null,
      transaction: null,
      onsuccess: null,
      onerror: null,
      onupgradeneeded: null,
    };

    queueMicrotask(() => {
      const existing = states.get(name);
      const shouldUpgrade = version !== undefined && (!existing || existing.version < version);

      if (!existing && version === undefined) {
        states.set(name, { version: 1, stores: new Map() });
      } else if (!existing && version !== undefined) {
        states.set(name, { version, stores: new Map() });
      } else if (existing && version !== undefined && existing.version < version) {
        existing.version = version;
      }

      request.result = createDatabaseView(name);

      if (shouldUpgrade) {
        request.transaction = {
          objectStore: (storeName: string) => createStoreView(name, storeName),
        };
        request.onupgradeneeded?.(new Event('upgradeneeded'));
      }

      request.onsuccess?.(new Event('success'));
    });

    return request;
  });

  const deleteDatabase = vi.fn((name: string) => {
    const request = {
      onsuccess: null as ((event: Event) => void) | null,
      onerror: null as ((event: Event) => void) | null,
      onblocked: null as ((event: Event) => void) | null,
    };

    queueMicrotask(() => {
      states.delete(name);
      request.onsuccess?.(new Event('success'));
    });

    return request;
  });

  const databases = includeDatabases
    ? vi.fn(async () =>
        Array.from(states.entries()).map(([name, state]) => ({ name, version: state.version })),
      )
    : undefined;

  const seedDatabase = (name: string, seed: SeedDatabase) => {
    const stores = new Map<string, StoreState>();
    for (const [storeName, storeSeed] of Object.entries(seed.stores ?? {})) {
      const records = new Map<string, SeedRecord>();
      for (const record of storeSeed.records ?? []) {
        records.set(String(record[storeSeed.keyPath]), cloneRecord(record));
      }
      stores.set(storeName, {
        keyPath: storeSeed.keyPath,
        records,
        indexes: new Set(),
      });
    }

    states.set(name, {
      version: seed.version,
      stores,
    });
  };

  return {
    factory: {
      open,
      deleteDatabase,
      ...(databases ? { databases } : {}),
    } as unknown as IDBFactory,
    open,
    deleteDatabase,
    databases,
    seedDatabase,
    hasDatabase: (name: string) => states.has(name),
    getRecords: (name: string, storeName: string) => {
      const state = states.get(name);
      const store = state?.stores.get(storeName);
      if (!store) return [];
      return Array.from(store.records.values()).map((record) => cloneRecord(record));
    },
  };
}

beforeEach(() => {
  localStorage.clear();
  vi.spyOn(console, 'warn').mockImplementation(() => {});
});

afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe('runHermesMigration', () => {
  it('marks a fresh install done without touching IndexedDB', async () => {
    const idb = createIndexedDbMock({ includeDatabases: true });
    idb.databases!.mockResolvedValue([]);
    vi.stubGlobal('indexedDB', idb.factory);

    await runHermesMigration();

    expect(localStorage.getItem('hermes:migration')).toBe('v1done');
    expect(idb.open).not.toHaveBeenCalled();
    expect(idb.deleteDatabase).not.toHaveBeenCalled();
  });

  it('still writes the guard key when IndexedDB migration fails', async () => {
    const open = vi.fn((name: string) => {
      if (name === 'hermes-ai') {
        throw new Error('boom');
      }

      const request = {
        result: { close: () => {}, objectStoreNames: { length: 0, contains: () => false } },
        error: null,
        onsuccess: null as ((event: Event) => void) | null,
        onerror: null as ((event: Event) => void) | null,
        onupgradeneeded: null as ((event: Event) => void) | null,
        transaction: null,
      };

      queueMicrotask(() => {
        request.onsuccess?.(new Event('success'));
      });

      return request;
    });

    vi.stubGlobal('indexedDB', {
      open,
      deleteDatabase: vi.fn(),
      databases: vi.fn(async () => [{ name: 'readest-ai', version: 1 }]),
    } as unknown as IDBFactory);

    await runHermesMigration();

    expect(localStorage.getItem('hermes:migration')).toBe('v1done');
  });

  it('copies legacy localStorage and IndexedDB data, then stays idle on rerun', async () => {
    const idb = createIndexedDbMock({ includeDatabases: true });
    idb.seedDatabase('readest-ai', {
      version: 1,
      stores: {
        bookMeta: {
          keyPath: 'bookHash',
          records: [{ bookHash: 'book-1', title: 'Legacy title' }],
        },
      },
    });
    idb.databases!.mockResolvedValue([{ name: 'readest-ai', version: 1 }]);
    vi.stubGlobal('indexedDB', idb.factory);
    localStorage.setItem('readest:theme', 'night');

    await runHermesMigration();

    expect(localStorage.getItem('hermes:theme')).toBe('night');
    expect(localStorage.getItem('readest:theme')).toBeNull();
    expect(idb.getRecords('hermes-ai', 'bookMeta')).toEqual([
      { bookHash: 'book-1', title: 'Legacy title' },
    ]);
    expect(idb.hasDatabase('readest-ai')).toBe(false);
    expect(localStorage.getItem('hermes:migration')).toBe('v1done');

    await runHermesMigration();

    expect(idb.open).toHaveBeenCalledTimes(2);
    expect(idb.deleteDatabase).toHaveBeenCalledTimes(1);
  });

  it('falls back to open-based legacy detection when databases() is unavailable', async () => {
    const idb = createIndexedDbMock({ includeDatabases: false });
    idb.seedDatabase('readest-ai', {
      version: 1,
      stores: {
        bookMeta: {
          keyPath: 'bookHash',
          records: [{ bookHash: 'book-2', title: 'Fallback title' }],
        },
      },
    });
    vi.stubGlobal('indexedDB', idb.factory);

    await runHermesMigration();

    expect(idb.open).toHaveBeenNthCalledWith(1, 'readest-ai');
    expect(idb.open).toHaveBeenNthCalledWith(2, 'readest-ai');
    expect(idb.open).toHaveBeenNthCalledWith(3, 'hermes-ai', 8);
    expect(idb.getRecords('hermes-ai', 'bookMeta')).toEqual([
      { bookHash: 'book-2', title: 'Fallback title' },
    ]);
    expect(idb.hasDatabase('readest-ai')).toBe(false);
    expect(localStorage.getItem('hermes:migration')).toBe('v1done');
  });

  it('does nothing when the guard is already present', async () => {
    const idb = createIndexedDbMock({ includeDatabases: true });
    idb.seedDatabase('readest-ai', {
      version: 1,
      stores: {
        bookMeta: {
          keyPath: 'bookHash',
          records: [{ bookHash: 'book-3', title: 'Should stay put' }],
        },
      },
    });
    idb.databases!.mockResolvedValue([{ name: 'readest-ai', version: 1 }]);
    vi.stubGlobal('indexedDB', idb.factory);
    localStorage.setItem('hermes:migration', 'v1done');
    localStorage.setItem('readest:theme', 'night');

    await runHermesMigration();

    expect(idb.open).not.toHaveBeenCalled();
    expect(idb.deleteDatabase).not.toHaveBeenCalled();
    expect(localStorage.getItem('readest:theme')).toBe('night');
    expect(localStorage.getItem('hermes:theme')).toBeNull();
  });
});
