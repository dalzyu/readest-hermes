/**
 * Integration test: traditional dictionary full import and lookup pipeline.
 *
 * Uses the real HanYuDaCiDian StarDict zip from .testdata/ with the real
 * dictionaryParser and fflate compression/decompression paths.
 * aiStore is replaced with an in-memory Map so no IndexedDB is required.
 *
 * Run time: 30-90 s (145 MB dict parse + gzip over 362 k entries).
 */
import { existsSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { beforeEach, describe, expect, test, vi } from 'vitest';

import type { UserDictionary } from '@/services/contextTranslation/types';

// ---------------------------------------------------------------------------
// In-memory store replaces aiStore so IndexedDB is not required
// ---------------------------------------------------------------------------
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

// simplecc requires WASM vendor files that are not present in the test
// environment. Provide a minimal conversion table for the cases under test.
vi.mock('@/utils/simplecc', () => ({
  initSimpleCC: vi.fn().mockResolvedValue(undefined),
  runSimpleCC: vi.fn((text: string, variant: string) => {
    const s2t: Record<string, string> = {
      一丁不识: '一丁不識',
      穿越: '穿越',
      魔王: '魔王',
    };
    const t2s: Record<string, string> = {
      一丁不識: '一丁不识',
    };
    if (variant === 's2t' || variant === 's2tw' || variant === 's2twp' || variant === 's2hk') {
      return s2t[text] ?? text;
    }
    if (variant === 't2s' || variant === 'tw2s' || variant === 'tw2sp' || variant === 'hk2s') {
      return t2s[text] ?? text;
    }
    return text;
  }),
}));

vi.mock('@/services/contextTranslation/plugins/jpTokenizer', () => ({
  getDictionaryForm: vi.fn((text: string) => text),
  isTokenizerReady: vi.fn(() => false),
}));

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

const dictZipPath = resolve(__dirname, '../../../../../.testdata/hanyudacidian-2.0-stardict.zip');
const hasRealDictionaryFixture = existsSync(dictZipPath);

function readDictZip(): Uint8Array {
  const buf = readFileSync(dictZipPath);
  return new Uint8Array(buf.buffer, buf.byteOffset, buf.byteLength);
}

// ---------------------------------------------------------------------------
// Import the subject under test *after* mocks are registered
// ---------------------------------------------------------------------------
const { importUserDictionary, deleteUserDictionary, lookupDefinitions, findMatches } =
  await import('@/services/contextTranslation/dictionaryService');

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------
beforeEach(() => {
  vi.clearAllMocks();
  records.clear();
  settingsRef.current = [];
});

describe.skipIf(!hasRealDictionaryFixture)('HanYuDaCiDian — full StarDict import', () => {
  test('parseDictionary returns 362k+ entries and correct dictionary name', async () => {
    const { parseDictionary } = await import('@/services/contextTranslation/parsers/formatRouter');
    const zip = readDictZip();
    const { entries, name } = await parseDictionary('hanyudacidian-2.0-stardict.zip', zip);
    expect(name).toBe('HanYuDaCiDian');
    expect(entries.length).toBeGreaterThan(300_000);
  }, 120_000);

  test('importUserDictionary stores the dict and returns correct metadata', async () => {
    const zip = readDictZip();
    const meta = await importUserDictionary(zip, {
      name: 'HanYuDaCiDian',
      language: 'zh',
      targetLanguage: 'zh',
    });

    expect(meta.name).toBe('HanYuDaCiDian');
    expect(meta.language).toBe('zh');
    expect(meta.targetLanguage).toBe('zh');
    expect(meta.entryCount).toBeGreaterThan(300_000);
    expect(meta.source).toBe('user');
    expect(meta.id).toMatch(/^user-/);
    // Settings must NOT be touched — that belongs to the UI layer
    expect(setSettingsSpy).not.toHaveBeenCalled();
    // aiStore.putRecord was called once
    expect(records.size).toBe(1);
  }, 120_000);
});

describe.skipIf(!hasRealDictionaryFixture)('HanYuDaCiDian — findMatches lookup tiers', () => {
  let importedMeta: UserDictionary;

  // Import once for the whole describe block
  beforeEach(async () => {
    if (importedMeta) return; // avoid re-importing across individual tests
    const zip = readDictZip();
    importedMeta = await importUserDictionary(zip, {
      name: 'HanYuDaCiDian',
      language: 'zh',
      targetLanguage: 'zh',
    });
  }, 120_000);

  // Tier 1: exact match
  test('exact match — 婀娜 returns headword and classical definition', async () => {
    const { parseDictionary } = await import('@/services/contextTranslation/parsers/formatRouter');
    const zip = readDictZip();
    const { entries } = await parseDictionary('hanyudacidian-2.0-stardict.zip', zip);

    const hits = findMatches(entries, '婀娜');
    expect(hits.length).toBeGreaterThan(0);
    expect(hits[0]!.headword).toBe('婀娜');
    expect(hits[0]!.definition).toContain('轻盈柔美');
  }, 120_000);

  test('reuses cached search index across repeated lookups', async () => {
    const { parseDictionary } = await import('@/services/contextTranslation/parsers/formatRouter');
    const zip = readDictZip();
    const { entries } = await parseDictionary('hanyudacidian-2.0-stardict.zip', zip);
    const sortSpy = vi.spyOn(Array.prototype, 'sort');

    try {
      const firstHits = findMatches(entries, '婀娜');
      const secondHits = findMatches(entries, '穿越');

      expect(firstHits.length).toBeGreaterThan(0);
      expect(firstHits[0]!.headword).toBe('婀娜');
      expect(secondHits.length).toBeGreaterThan(0);
      expect(secondHits[0]!.headword).toBe('穿越');
      expect(sortSpy).toHaveBeenCalledTimes(1);
    } finally {
      sortSpy.mockRestore();
    }
  }, 120_000);

  test('exact match — 穿越 is present in the dictionary', async () => {
    const { parseDictionary } = await import('@/services/contextTranslation/parsers/formatRouter');
    const zip = readDictZip();
    const { entries } = await parseDictionary('hanyudacidian-2.0-stardict.zip', zip);

    const hits = findMatches(entries, '穿越');
    expect(hits.length).toBeGreaterThan(0);
    expect(hits[0]!.headword).toBe('穿越');
  }, 120_000);

  test('exact match — 魔王 includes classical definition', async () => {
    const { parseDictionary } = await import('@/services/contextTranslation/parsers/formatRouter');
    const zip = readDictZip();
    const { entries } = await parseDictionary('hanyudacidian-2.0-stardict.zip', zip);

    const hits = findMatches(entries, '魔王');
    expect(hits.length).toBeGreaterThan(0);
    expect(hits[0]!.headword).toBe('魔王');
    expect(hits[0]!.definition).toMatch(/魔界|鬼/);
  }, 120_000);

  // Tier 2: prefix fallback — compound not a headword → returns leading character
  test('prefix fallback — 封号法师 returns a 封-prefix entry', async () => {
    const { parseDictionary } = await import('@/services/contextTranslation/parsers/formatRouter');
    const zip = readDictZip();
    const { entries } = await parseDictionary('hanyudacidian-2.0-stardict.zip', zip);

    const hits = findMatches(entries, '封号法师');
    expect(hits.length).toBeGreaterThan(0);
    expect(hits[0]!.headword.startsWith('封')).toBe(true);
  }, 120_000);

  // Traditional character lookup — dictionary has traditional headwords
  test('exact match of traditional headword — 一丁不識 found directly', async () => {
    const { parseDictionary } = await import('@/services/contextTranslation/parsers/formatRouter');
    const zip = readDictZip();
    const { entries } = await parseDictionary('hanyudacidian-2.0-stardict.zip', zip);

    const hits = findMatches(entries, '一丁不識');
    expect(hits.length).toBeGreaterThan(0);
    expect(hits[0]!.headword).toBe('一丁不識');
  }, 120_000);
});

describe.skipIf(!hasRealDictionaryFixture)('HanYuDaCiDian — lookupDefinitions end-to-end', () => {
  let importedMeta: UserDictionary;

  beforeEach(async () => {
    if (importedMeta) return;
    const zip = readDictZip();
    importedMeta = await importUserDictionary(zip, {
      name: 'HanYuDaCiDian',
      language: 'zh',
      targetLanguage: 'zh',
    });
  }, 120_000);

  test('lookupDefinitions — exact hit for 婀娜 when meta is registered and enabled', async () => {
    settingsRef.current = [{ ...importedMeta, enabled: true }];

    const results = await lookupDefinitions('婀娜', 'zh', 'zh', settingsRef.current);
    expect(results.length).toBeGreaterThan(0);
    expect(results[0]!.headword).toBe('婀娜');
    expect(results[0]!.definition).toContain('轻盈柔美');
  }, 120_000);

  test('lookupDefinitions — simplified term finds match (穿越 exact, zh→zh)', async () => {
    settingsRef.current = [{ ...importedMeta, enabled: true }];

    const results = await lookupDefinitions('穿越', 'zh', 'zh', settingsRef.current);
    expect(results.length).toBeGreaterThan(0);
    expect(results[0]!.headword).toBe('穿越');
  }, 120_000);

  test('lookupDefinitions — disabled dictionary is not queried', async () => {
    settingsRef.current = [{ ...importedMeta, enabled: false }];

    const results = await lookupDefinitions('婀娜', 'zh', 'zh', settingsRef.current);
    expect(results).toHaveLength(0);
  }, 120_000);

  test('lookupDefinitions — wrong source language excludes the dictionary', async () => {
    // Dict is zh→zh; querying with sourceLang ja should not include it
    settingsRef.current = [{ ...importedMeta, enabled: true }];

    const results = await lookupDefinitions('婀娜', 'ja', 'en', settingsRef.current);
    expect(results).toHaveLength(0);
  }, 120_000);

  test('lookupDefinitions — simplified input finds traditional headword via simplecc variants', async () => {
    settingsRef.current = [{ ...importedMeta, enabled: true }];

    // 一丁不识 (simplified) → simplecc s2t → 一丁不識 (traditional headword)
    const results = await lookupDefinitions('一丁不识', 'zh', 'zh', settingsRef.current);
    expect(results.length).toBeGreaterThan(0);
    // headword should be the traditional form (or simplified if dict has it)
    expect(results[0]!.headword === '一丁不識' || results[0]!.headword.includes('一丁')).toBe(true);
  }, 120_000);

  test('deleteUserDictionary — subsequent lookupDefinitions returns nothing', async () => {
    settingsRef.current = [{ ...importedMeta, enabled: true }];

    // Confirm it works before deletion
    const before = await lookupDefinitions('婀娜', 'zh', 'zh', settingsRef.current);
    expect(before.length).toBeGreaterThan(0);

    // Delete and clear meta
    await deleteUserDictionary(importedMeta.id);
    settingsRef.current = [];

    const after = await lookupDefinitions('婀娜', 'zh', 'zh', settingsRef.current);
    expect(after).toHaveLength(0);
  }, 120_000);
});

describe('findMatches — lookup tier semantics (from parsed entries)', () => {
  const ENTRIES = [
    { headword: '一', definition: 'number one' },
    { headword: '一一', definition: 'one by one' },
    { headword: '穿越', definition: 'to pass through' },
    { headword: '婀娜', definition: '轻盈柔美貌' },
    { headword: '婀娜多姿', definition: 'gracefully slender' },
    { headword: '魔王', definition: 'demon king' },
  ];

  test('exact match takes priority over prefix and fuzzy', () => {
    const hits = findMatches(ENTRIES, '穿越');
    expect(hits[0]!.headword).toBe('穿越');
  });

  test('prefix-forward: 婀 returns entries starting with 婀', () => {
    const hits = findMatches(ENTRIES, '婀');
    expect(hits.every((h) => h.headword.startsWith('婀'))).toBe(true);
  });

  test('prefix-reverse: 魔王军 (not headword) → prefix-reverse finds 魔王', () => {
    const hits = findMatches(ENTRIES, '魔王军');
    expect(hits[0]!.headword).toBe('魔王');
  });

  test('empty text returns nothing', () => {
    expect(findMatches(ENTRIES, '')).toHaveLength(0);
  });

  test('no match returns empty array', () => {
    expect(findMatches(ENTRIES, '异世界')).toHaveLength(0);
  });

  test('deduplicates by normalized headword', () => {
    const dup = [
      { headword: '魔王', definition: 'version A' },
      { headword: '魔王', definition: 'version B' },
    ];
    const hits = findMatches(dup, '魔王');
    expect(hits).toHaveLength(1);
  });
});
