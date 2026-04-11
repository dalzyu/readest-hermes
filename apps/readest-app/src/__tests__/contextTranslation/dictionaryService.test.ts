import { describe, test, expect, vi, beforeEach } from 'vitest';
import type { DictionaryEntry, UserDictionary } from '@/services/contextTranslation/types';
import {
  findMatches,
  importUserDictionary,
  deleteUserDictionary,
  getUserDictionaryMeta,
  saveUserDictionaryMeta,
} from '@/services/contextTranslation/dictionaryService';

// --- Shared mock state ---
// Mutated directly so Zustand-like mock reads updated values
const settingsRef = { current: [] as UserDictionary[] };
const setSettingsSpy = vi.fn((patch: { userDictionaryMeta?: UserDictionary[] }) => {
  if (patch.userDictionaryMeta !== undefined) {
    settingsRef.current = patch.userDictionaryMeta;
  }
});

// In-memory record store for aiStore mock
const records = new Map<string, unknown>();

// --- Mocks ---
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
}));

vi.mock('@/services/contextTranslation/dictionaryParser', () => {
  const encoder = new TextEncoder();
  return {
    extractFromZip: vi.fn(async () => ({
      ifo: encoder.encode('bookname=Dummy\nwordcount=2\nsametypesequence=m\n'),
      idx: encoder.encode(
        'hello\x00\x00\x00\x00\x00\x00\x00\x05world\x00\x00\x00\x00\x00\x00\x00\x0a',
      ),
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

function fakeZipBuffer(): Uint8Array {
  return new Uint8Array([0x50, 0x4b, 0x03, 0x04]);
}

// --- Tests ---

describe('getUserDictionaryMeta', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    settingsRef.current = [];
  });

  test('returns empty array when no meta exists', async () => {
    const result = await getUserDictionaryMeta();
    expect(result).toEqual([]);
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
    const result = await getUserDictionaryMeta();
    expect(result).toEqual(meta);
  });
});

describe('saveUserDictionaryMeta', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    settingsRef.current = [];
    setSettingsSpy.mockClear();
  });

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
    const call = setSettingsSpy.mock.calls[0]![0] as { userDictionaryMeta: UserDictionary[] };
    expect(call.userDictionaryMeta).toEqual(meta);
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
    const call = setSettingsSpy.mock.calls[0]![0] as { userDictionaryMeta: UserDictionary[] };
    expect(call.userDictionaryMeta).toEqual(newMeta);
  });
});

describe('importUserDictionary', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    settingsRef.current = [];
    setSettingsSpy.mockClear();
  });

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

  test('saves meta to settings store after import', async () => {
    await importUserDictionary(fakeZipBuffer(), {
      name: 'Second',
      language: 'ja',
      targetLanguage: 'en',
    });

    const call = setSettingsSpy.mock.calls[0]![0] as { userDictionaryMeta: UserDictionary[] };
    expect(call.userDictionaryMeta).toHaveLength(1);
    expect(call.userDictionaryMeta[0]!.name).toBe('Second');
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
    const { importUserDictionary: reimport } =
      await import('@/services/contextTranslation/dictionaryService');

    await expect(
      reimport(fakeZipBuffer(), {
        name: 'Empty',
        language: 'en',
        targetLanguage: 'zh',
      }),
    ).rejects.toThrow('Dictionary has 0 entries');

    // Restore the module-level mock for subsequent tests
    vi.doMock('@/services/contextTranslation/dictionaryParser', () => {
      const encoder = new TextEncoder();
      return {
        extractFromZip: vi.fn(async () => ({
          ifo: encoder.encode('bookname=Dummy\nwordcount=2\nsametypesequence=m\n'),
          idx: encoder.encode(
            'hello\x00\x00\x00\x00\x00\x00\x00\x05world\x00\x00\x00\x00\x00\x00\x00\x0a',
          ),
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
    vi.resetModules();
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
    settingsRef.current = [];
    setSettingsSpy.mockClear();
    records.clear();
    // Pre-import two dictionaries so there is something to delete
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
    const record = await aiStore.getRecord('dictionaryData', id);
    expect(record).toBeNull();
  });

  test('removes meta from settings store', async () => {
    const id = settingsRef.current[0]!.id;
    await deleteUserDictionary(id);
    const call = setSettingsSpy.mock.calls[0]![0] as { userDictionaryMeta: UserDictionary[] };
    expect(call.userDictionaryMeta.find((m) => m.id === id)).toBeUndefined();
  });

  test('deleting non-existent id does not throw', async () => {
    await expect(deleteUserDictionary('does-not-exist')).resolves.not.toThrow();
  });
});

describe('findMatches', () => {
  const makeEntry = (headword: string, definition: string): DictionaryEntry => ({
    headword,
    definition,
  });

  describe('exact match', () => {
    test('returns entry when headword exactly matches text', () => {
      const entries: DictionaryEntry[] = [
        makeEntry('hello', 'a greeting'),
        makeEntry('world', 'the planet'),
      ];
      const result = findMatches(entries, 'hello');
      expect(result).toHaveLength(1);
      expect(result[0]!.headword).toBe('hello');
    });

    test('case-sensitive exact match', () => {
      const entries: DictionaryEntry[] = [
        makeEntry('Hello', 'a greeting'),
        makeEntry('hello', 'lowercase greeting'),
      ];
      const result = findMatches(entries, 'Hello');
      expect(result).toHaveLength(1);
      expect(result[0]!.headword).toBe('Hello');
    });

    test('returns empty when no exact match', () => {
      const entries: DictionaryEntry[] = [makeEntry('hello', 'a greeting')];
      const result = findMatches(entries, 'world');
      expect(result).toHaveLength(0);
    });
  });

  describe('prefix: headword starts with text', () => {
    test('returns matching entries when headword starts with text', () => {
      const entries: DictionaryEntry[] = [
        makeEntry('hyperbolic', 'exaggerated'),
        makeEntry('hyperbole', 'figure of speech'),
        makeEntry('hypersonic', 'faster than sound'),
      ];
      const result = findMatches(entries, 'hyper');
      expect(result.map((e) => e.headword)).toEqual(['hyperbole', 'hyperbolic', 'hypersonic']);
    });

    test('skipped when text.length > 40', () => {
      const entries: DictionaryEntry[] = [makeEntry('hyperbolically', 'in a hyperbolic manner')];
      const longText = 'a'.repeat(41);
      const result = findMatches(entries, longText);
      expect(result).toHaveLength(0);
    });
  });

  describe('prefix: text starts with headword', () => {
    test('returns entry when text starts with headword', () => {
      const entries: DictionaryEntry[] = [makeEntry('hello', 'a greeting')];
      const result = findMatches(entries, 'hello world');
      expect(result).toHaveLength(1);
      expect(result[0]!.headword).toBe('hello');
    });

    test('returns multiple matches', () => {
      const entries: DictionaryEntry[] = [
        makeEntry('a', 'article'),
        makeEntry('an', 'article'),
        makeEntry('and', 'conjunction'),
      ];
      const result = findMatches(entries, 'and');
      expect(result.map((e) => e.headword)).toEqual(['and']);
    });

    test('skipped when text.length > 40', () => {
      const entries: DictionaryEntry[] = [makeEntry('hello', 'a greeting')];
      const longText = 'hello' + 'a'.repeat(40);
      const result = findMatches(entries, longText);
      expect(result).toHaveLength(0);
    });
  });

  describe('fuzzy: Levenshtein distance <= 2', () => {
    test('returns entry when text is within Levenshtein distance 2', () => {
      const entries: DictionaryEntry[] = [makeEntry('hello', 'a greeting')];
      const result = findMatches(entries, 'helo');
      expect(result).toHaveLength(1);
      expect(result[0]!.headword).toBe('hello');
    });

    test('distance 1 is included', () => {
      const entries: DictionaryEntry[] = [makeEntry('world', 'the planet')];
      const result = findMatches(entries, 'worle');
      expect(result).toHaveLength(1);
      expect(result[0]!.headword).toBe('world');
    });

    test('distance 2 is included', () => {
      const entries: DictionaryEntry[] = [makeEntry('language', 'system of communication')];
      const result = findMatches(entries, 'lnaguage');
      expect(result).toHaveLength(1);
      expect(result[0]!.headword).toBe('language');
    });

    test('distance 3 is excluded', () => {
      const entries: DictionaryEntry[] = [makeEntry('abc', 'three letters')];
      const result = findMatches(entries, 'xyz');
      expect(result).toHaveLength(0);
    });

    test('fuzzy only runs when text.length <= 40', () => {
      const entries: DictionaryEntry[] = [makeEntry('hello', 'a greeting')];
      const longText = 'hello' + 'a'.repeat(36);
      const result = findMatches(entries, longText);
      expect(result).toHaveLength(0);
    });

    test('fuzzy selects up to ~200 nearest candidates', () => {
      const entries: DictionaryEntry[] = Array.from({ length: 500 }, (_, i) =>
        makeEntry(`word${i.toString().padStart(4, '0')}`, `definition ${i}`),
      );
      const result = findMatches(entries, 'word0002');
      expect(result).toHaveLength(1);
      expect(result[0]!.headword).toBe('word0002');
    });
  });

  describe('result assembly', () => {
    test('deduplicates by headword', () => {
      const entries: DictionaryEntry[] = [
        makeEntry('hello', 'a greeting'),
        makeEntry('hello', 'another greeting'),
      ];
      const result = findMatches(entries, 'hello');
      expect(result).toHaveLength(1);
    });

    test('capped at 3 total results', () => {
      const entries: DictionaryEntry[] = [
        makeEntry('a', 'article 1'),
        makeEntry('an', 'article 2'),
        makeEntry('and', 'conjunction'),
        makeEntry('ant', 'insect'),
        makeEntry('android', 'robot'),
      ];
      const result = findMatches(entries, 'a');
      expect(result.length).toBeLessThanOrEqual(3);
    });

    test('prefers exact match over prefix over fuzzy', () => {
      const entries: DictionaryEntry[] = [
        makeEntry('hello', 'exact match'),
        makeEntry('hello world', 'prefix match'),
      ];
      const result = findMatches(entries, 'hello');
      expect(result[0]!.headword).toBe('hello');
    });
  });

  describe('binary search for exact match', () => {
    test('works on sorted entries', () => {
      const entries: DictionaryEntry[] = [
        makeEntry('apple', 'fruit'),
        makeEntry('banana', 'fruit'),
        makeEntry('cherry', 'fruit'),
        makeEntry('date', 'fruit'),
      ];
      const result = findMatches(entries, 'banana');
      expect(result).toHaveLength(1);
      expect(result[0]!.headword).toBe('banana');
    });

    test('empty entries array', () => {
      const result = findMatches([], 'hello');
      expect(result).toHaveLength(0);
    });
  });
});
