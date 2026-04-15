import { beforeEach, describe, expect, test, vi } from 'vitest';
import type { DictionaryEntry, UserDictionary } from '@/services/contextTranslation/types';
import {
  deleteUserDictionary,
  findMatches,
  getUserDictionaryMeta,
  importUserDictionary,
  lookupDefinitions,
  saveUserDictionaryMeta,
} from '@/services/contextTranslation/dictionaryService';

const records = new Map<string, unknown>();
const settingsRef = { current: [] as UserDictionary[] };
const setSettingsSpy = vi.fn((patch: { userDictionaryMeta?: UserDictionary[] }) => {
  if (patch.userDictionaryMeta !== undefined) {
    settingsRef.current = patch.userDictionaryMeta;
  }
});

vi.mock('@/services/ai/storage/aiStore', () => ({
  aiStore: {
    async putRecord(_store: string, record: unknown) {
      records.set((record as { id: string }).id, record);
    },
    async getRecord(_store: string, id: string) {
      return records.get(id) ?? null;
    },
    async deleteRecord(_store: string, id: string) {
      records.delete(id);
    },
  },
}));

vi.mock('fflate', () => ({
  gzip: vi.fn((data: Uint8Array, cb: (err: Error | null, result: Uint8Array) => void) => {
    cb(null, data);
  }),
  decompress: vi.fn((data: Uint8Array, cb: (err: Error | null, result: Uint8Array) => void) => {
    cb(null, data);
  }),
}));

vi.mock('@/store/settingsStore', () => ({
  useSettingsStore: Object.assign(() => ({}), {
    getState: () => ({
      settings: {
        get userDictionaryMeta() {
          return settingsRef.current;
        },
      },
      setSettings: setSettingsSpy,
    }),
    set: vi.fn(),
    subscribe: () => () => {},
  }),
}));

vi.mock('@/services/contextTranslation/dictionaryParser', () => {
  const encoder = new TextEncoder();
  return {
    extractFromZip: vi.fn(async () => ({
      ifo: encoder.encode('bookname=Dummy\nwordcount=2\nsametypesequence=m\n'),
      idx: encoder.encode('hello\x00\x00\x00\x00\x00\x00\x00\x05world\x00\x00\x00\x00\x00\x00\x00\x0a'),
      dict: encoder.encode('definition for hello\x00definition for world'),
    })),
    parseStarDict: vi.fn(() => [
      { headword: 'hello', definition: 'a greeting' },
      { headword: 'world', definition: 'the planet' },
    ]),
    parseIfo: vi.fn((buffer: Uint8Array) => {
      const text = new TextDecoder('utf-8').decode(buffer);
      const lines = text.split(/\r?\n/);
      const parsed: Record<string, string> = {};
      for (const line of lines) {
        const eqIndex = line.indexOf('=');
        if (eqIndex === -1) continue;
        parsed[line.slice(0, eqIndex)] = line.slice(eqIndex + 1);
      }
      return {
        name: parsed['bookname'] ?? '',
        wordcount: parseInt(parsed['wordcount'] ?? '0', 10),
      };
    }),
  };
});

vi.mock('@/services/contextTranslation/plugins/jpTokenizer', () => ({
  getDictionaryForm: vi.fn((text: string) => text),
  isTokenizerReady: vi.fn(() => false),
}));

function fakeZipBuffer(): Uint8Array {
  return new Uint8Array([0x50, 0x4b, 0x03, 0x04]);
}

beforeEach(() => {
  vi.clearAllMocks();
  records.clear();
  settingsRef.current = [];
});

describe('getUserDictionaryMeta', () => {
  test('returns empty array when no meta exists', async () => {
    await expect(getUserDictionaryMeta()).resolves.toEqual([]);
  });

  test('returns stored meta entries', async () => {
    const meta: UserDictionary[] = [
      {
        id: 'user-dict-1',
        name: 'Test Dictionary',
        language: 'en',
        targetLanguage: 'zh',
        entryCount: 100,
        source: 'user',
        importedAt: 1700000000000,
      },
    ];
    settingsRef.current = meta;

    await expect(getUserDictionaryMeta()).resolves.toEqual(meta);
  });
});

describe('saveUserDictionaryMeta', () => {
  test('persists meta array to settings store', async () => {
    const meta: UserDictionary[] = [
      {
        id: 'user-dict-1',
        name: 'My Dictionary',
        language: 'de',
        targetLanguage: 'en',
        entryCount: 50,
        source: 'user',
        importedAt: 1700000000000,
      },
    ];

    await saveUserDictionaryMeta(meta);

    expect(setSettingsSpy).toHaveBeenCalledOnce();
    expect(setSettingsSpy).toHaveBeenCalledWith({ userDictionaryMeta: meta });
  });

  test('replaces existing meta', async () => {
    settingsRef.current = [
      {
        id: 'old',
        name: 'Old',
        language: 'en',
        targetLanguage: 'de',
        entryCount: 10,
        source: 'user',
        importedAt: 1000,
      },
    ];
    const newMeta: UserDictionary[] = [
      {
        id: 'new',
        name: 'New',
        language: 'fr',
        targetLanguage: 'en',
        entryCount: 200,
        source: 'user',
        importedAt: 2000,
      },
    ];

    await saveUserDictionaryMeta(newMeta);

    expect(setSettingsSpy).toHaveBeenCalledWith({ userDictionaryMeta: newMeta });
  });
});

describe('importUserDictionary', () => {
  test('imports zip and returns UserDictionary meta', async () => {
    const result = await importUserDictionary(fakeZipBuffer(), {
      name: 'Test Dict',
      language: 'en',
      targetLanguage: 'zh',
    });

    expect(result.name).toBe('Test Dict');
    expect(result.language).toBe('en');
    expect(result.targetLanguage).toBe('zh');
    expect(result.entryCount).toBeGreaterThan(0);
    expect(result.source).toBe('user');
    expect(result.id).toMatch(/^user-/);
    expect(result.importedAt).toBeGreaterThan(0);
  });

  test('wraps plain-text import errors with filename context', async () => {
    const brokenFile = new File(['hello\nworld'], 'broken.txt', { type: 'text/plain' });

    await expect(
      importUserDictionary(brokenFile, {
        name: 'Broken',
        language: 'en',
        targetLanguage: 'zh',
      }),
    ).rejects.toThrow('Failed to import broken.txt');
  });

  test('saves meta to settings store after import', async () => {
    await importUserDictionary(fakeZipBuffer(), {
      name: 'Second',
      language: 'ja',
      targetLanguage: 'en',
    });

    expect(setSettingsSpy).toHaveBeenCalled();
    expect(settingsRef.current).toHaveLength(1);
    expect(settingsRef.current[0]!.name).toBe('Second');
  });

  test('throws when dictionary has zero entries', async () => {
    vi.doMock('@/services/contextTranslation/dictionaryParser', () => ({
      extractFromZip: vi.fn(async () => ({
        ifo: new Uint8Array(),
        idx: new Uint8Array(),
        dict: new Uint8Array(),
      })),
      parseStarDict: vi.fn(() => []),
      parseIfo: vi.fn(() => ({ name: 'Empty', wordcount: 0 })),
    }));
    vi.resetModules();
    const { importUserDictionary: reimport } = await import(
      '@/services/contextTranslation/dictionaryService',
    );

    await expect(
      reimport(fakeZipBuffer(), {
        name: 'Empty',
        language: 'en',
        targetLanguage: 'zh',
      }),
    ).rejects.toThrow('Dictionary has 0 entries');
  });

  test('assigns a unique id per import', async () => {
    const r1 = await importUserDictionary(fakeZipBuffer(), {
      name: 'A',
      language: 'en',
      targetLanguage: 'de',
    });
    const r2 = await importUserDictionary(fakeZipBuffer(), {
      name: 'B',
      language: 'en',
      targetLanguage: 'fr',
    });

    expect(r1.id).not.toBe(r2.id);
  });
});

describe('deleteUserDictionary', () => {
  beforeEach(async () => {
    vi.clearAllMocks();
    records.clear();
    settingsRef.current = [];
    await importUserDictionary(fakeZipBuffer(), {
      name: 'Dict A',
      language: 'en',
      targetLanguage: 'zh',
    });
    await importUserDictionary(fakeZipBuffer(), {
      name: 'Dict B',
      language: 'ja',
      targetLanguage: 'en',
    });
    setSettingsSpy.mockClear();
  });

  test('removes record from aiStore', async () => {
    const { aiStore } = await import('@/services/ai/storage/aiStore');
    const id = settingsRef.current[0]!.id;

    await deleteUserDictionary(id);

    await expect(aiStore.getRecord('dictionaryData', id)).resolves.toBeNull();
  });

  test('removes meta from settings store', async () => {
    const id = settingsRef.current[0]!.id;

    await deleteUserDictionary(id);

    expect(settingsRef.current.find((meta) => meta.id === id)).toBeUndefined();
    expect(setSettingsSpy).toHaveBeenCalled();
  });

  test('deleting non-existent id does not throw', async () => {
    await expect(deleteUserDictionary('does-not-exist')).resolves.not.toThrow();
  });
});

describe('lookupDefinitions', () => {
  const encoder = new TextEncoder();

  const storeDictionaryRecord = (meta: UserDictionary, entries: DictionaryEntry[]) => {
    records.set(meta.id, {
      id: meta.id,
      meta,
      blob: encoder.encode(JSON.stringify(entries)),
    });
  };

  beforeEach(() => {
    vi.clearAllMocks();
    records.clear();
    settingsRef.current = [];
  });

  test('returns matches from enabled user dictionaries', async () => {
    settingsRef.current = [
      {
        id: 'user-zh-en',
        name: 'Custom Zh-En',
        language: 'zh',
        targetLanguage: 'en',
        entryCount: 1,
        source: 'user',
        importedAt: 1_800_000_000,
        enabled: true,
      },
    ];
    storeDictionaryRecord(settingsRef.current[0]!, [
      { headword: '你好', definition: 'custom hello' },
    ]);

    const result = await lookupDefinitions('你好', 'zh', 'en');

    expect(result).toHaveLength(1);
    expect(result[0]!.definition).toBe('custom hello');
    expect(result[0]!.source).toBe('Custom Zh-En');
  });

  test('skips disabled user dictionaries', async () => {
    settingsRef.current = [
      {
        id: 'user-zh-en',
        name: 'Disabled Dict',
        language: 'zh',
        targetLanguage: 'en',
        entryCount: 1,
        source: 'user',
        importedAt: 1_800_000_000,
        enabled: false,
      },
    ];
    storeDictionaryRecord(settingsRef.current[0]!, [
      { headword: '你好', definition: 'disabled hello' },
    ]);

    await expect(lookupDefinitions('你好', 'zh', 'en')).resolves.toEqual([]);
  });

  test('returns empty array for empty text', async () => {
    await expect(lookupDefinitions('', 'zh', 'en')).resolves.toEqual([]);
  });
});

describe('findMatches', () => {
  const makeEntry = (headword: string, definition: string): DictionaryEntry => ({
    headword,
    definition,
  });

  test('returns exact matches', () => {
    const entries = [makeEntry('hello', 'a greeting'), makeEntry('world', 'the planet')];

    const result = findMatches(entries, 'hello');

    expect(result).toHaveLength(1);
    expect(result[0]!.headword).toBe('hello');
  });

  test('returns prefix matches and caps results', () => {
    const entries = [
      makeEntry('hyperbolic', 'exaggerated'),
      makeEntry('hyperbole', 'figure of speech'),
      makeEntry('hypersonic', 'faster than sound'),
    ];

    const result = findMatches(entries, 'hyper');

    expect(result.map((entry) => entry.headword)).toEqual([
      'hyperbole',
      'hyperbolic',
      'hypersonic',
    ]);
  });

  test('returns fuzzy matches within edit distance 2', () => {
    const entries = [makeEntry('language', 'system of communication')];

    const result = findMatches(entries, 'lnaguage');

    expect(result).toHaveLength(1);
    expect(result[0]!.headword).toBe('language');
  });

  test('returns empty array for long unmatched text', () => {
    const entries = [makeEntry('hello', 'a greeting')];

    expect(findMatches(entries, 'a'.repeat(41))).toEqual([]);
  });
});
