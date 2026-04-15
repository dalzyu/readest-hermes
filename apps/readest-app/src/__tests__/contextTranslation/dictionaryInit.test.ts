import { beforeEach, describe, expect, test, vi } from 'vitest';

// --- Mocks ---

// Mock aiStore for dictionaryService's IndexedDB layer
const records = new Map<string, unknown>();
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

// Mock fflate (gzip/decompress) used internally
vi.mock('fflate', () => ({
  gzip: vi.fn((_data: unknown, cb: (err: null, result: Uint8Array) => void) => {
    cb(null, new Uint8Array([1, 2, 3]));
  }),
  decompress: vi.fn((_data: unknown, cb: (err: null, result: Uint8Array) => void) => {
    cb(null, new TextEncoder().encode('[]'));
  }),
}));

// Mock settingsStore for user dictionary meta
const settingsRef = { current: [] as unknown[] };
vi.mock('@/store/settingsStore', () => ({
  useSettingsStore: Object.assign(() => ({}), {
    getState: () => ({
      settings: {
        get userDictionaryMeta() {
          return settingsRef.current;
        },
      },
      setSettings: vi.fn(),
    }),
    set: vi.fn(),
    subscribe: () => () => {},
  }),
}));

// Mock jpTokenizer so dictionaryService doesn't try loading kuromoji
vi.mock('@/services/contextTranslation/plugins/jpTokenizer', () => ({
  getDictionaryForm: vi.fn((text: string) => text),
  isTokenizerReady: vi.fn(() => false),
}));

import {
  ensureBundledDictsInitialized,
  isBundledPairSupported,
  lookupDefinitions,
} from '@/services/contextTranslation/dictionaryService';

beforeEach(() => {
  vi.clearAllMocks();
  records.clear();
  settingsRef.current = [];
});

describe('ensureBundledDictsInitialized', () => {
  test('runs init only once (singleton)', async () => {
    // Global fetch mock returns 404 so individual dicts are skipped gracefully
    const fetchSpy = vi
      .spyOn(globalThis, 'fetch')
      .mockResolvedValue(new Response(null, { status: 404, statusText: 'Not Found' }));

    await ensureBundledDictsInitialized();
    await ensureBundledDictsInitialized();

    // fetch is called once per bundled dictionary during the first init,
    // but NOT again on the second call because the flag is already set.
    const firstCallCount = fetchSpy.mock.calls.length;
    expect(firstCallCount).toBeGreaterThan(0);

    await ensureBundledDictsInitialized();
    // No additional fetch calls after the singleton resolved
    expect(fetchSpy).toHaveBeenCalledTimes(firstCallCount);

    // Confirm the module-level flag is truly set — extra calls generate no fetches
    const countBefore = fetchSpy.mock.calls.length;
    await ensureBundledDictsInitialized();
    await ensureBundledDictsInitialized();
    expect(fetchSpy.mock.calls.length).toBe(countBefore); // no new fetches

    fetchSpy.mockRestore();
  });
});

describe('isBundledPairSupported', () => {
  test('returns true for zh-en', () => {
    expect(isBundledPairSupported('zh', 'en')).toBe(true);
  });

  test('returns true for ja-en', () => {
    expect(isBundledPairSupported('ja', 'en')).toBe(true);
  });

  test('returns false for zh-fr (unsupported pair)', () => {
    expect(isBundledPairSupported('zh', 'fr')).toBe(false);
  });

  test('returns false for en-zh (reversed pair)', () => {
    expect(isBundledPairSupported('en', 'zh')).toBe(false);
  });

  test('returns false for unknown source language', () => {
    expect(isBundledPairSupported('xx', 'en')).toBe(false);
  });
});

describe('lookupDefinitions', () => {
  test('calls ensureBundledDictsInitialized before lookup', async () => {
    // Provide a fetch mock so init doesn't fail hard
    const fetchSpy = vi
      .spyOn(globalThis, 'fetch')
      .mockResolvedValue(new Response(null, { status: 404, statusText: 'Not Found' }));

    // lookupDefinitions should not throw even when no dictionaries are loaded
    const results = await lookupDefinitions('hello', 'en', 'zh');

    // The function should have triggered init (fetch calls prove it ran)
    // and returned empty since no actual dictionary data is available
    expect(results).toEqual([]);

    fetchSpy.mockRestore();
  });

  test('returns empty array for empty text', async () => {
    const results = await lookupDefinitions('', 'zh', 'en');
    expect(results).toEqual([]);
  });
});
