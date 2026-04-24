import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest';

import {
  clearLookupHistory,
  getLookupHistoryForBook,
  saveLookupHistoryEntry,
} from '@/services/contextTranslation/lookupHistoryService';

const makeEntry = (overrides: Partial<Parameters<typeof saveLookupHistoryEntry>[0]> = {}) => ({
  bookHash: 'book-1',
  term: '知己',
  context: 'He had finally found a true 知己.',
  result: { translation: 'close friend' },
  mode: 'translation' as const,
  ...overrides,
});

beforeEach(() => {
  clearLookupHistory();
});

afterEach(() => {
  vi.restoreAllMocks();
});

describe('lookupHistoryService', () => {
  test('stores completed lookups and returns newest-first history for a book', () => {
    const nowSpy = vi.spyOn(Date, 'now');
    nowSpy.mockReturnValueOnce(1_000).mockReturnValueOnce(2_000).mockReturnValue(3_000);

    saveLookupHistoryEntry(makeEntry({ term: 'old' }));
    saveLookupHistoryEntry(makeEntry({ term: 'new' }));
    saveLookupHistoryEntry({ ...makeEntry({ bookHash: 'book-2', term: 'other' }) });

    const history = getLookupHistoryForBook('book-1');

    expect(history).toHaveLength(2);
    expect(history[0]!.term).toBe('new');
    expect(history[0]!.recordedAt).toBe(2_000);
    expect(history[1]!.term).toBe('old');
    expect(history[1]!.recordedAt).toBe(1_000);
  });

  test('deduplicates by normalized signature and refreshes recordedAt and location', () => {
    const nowSpy = vi.spyOn(Date, 'now');
    nowSpy.mockReturnValueOnce(1_000).mockReturnValueOnce(2_000);

    saveLookupHistoryEntry(
      makeEntry({
        context: 'First context',
        location: 'epubcfi(/6/2:0)',
        result: { simpleDefinition: ' companion ', translation: ' close friend ' },
      }),
    );
    saveLookupHistoryEntry(
      makeEntry({
        context: 'Second context',
        location: 'epubcfi(/6/4:10)',
        result: { translation: 'close friend', simpleDefinition: 'companion' },
      }),
    );

    const history = getLookupHistoryForBook('book-1');
    const stored = JSON.parse(localStorage.getItem('hermes:lookup-history:v2')!);

    expect(history).toHaveLength(1);
    expect(history[0]).toMatchObject({
      recordedAt: 2_000,
      context: 'Second context',
      location: 'epubcfi(/6/4:10)',
      term: '知己',
      bookHash: 'book-1',
      mode: 'translation',
    });
    expect(history[0]!.result).toEqual({
      simpleDefinition: 'companion',
      translation: 'close friend',
    });
    expect(stored).toEqual({ version: 2, entries: history });
  });

  test('migrates legacy v1 arrays into v2 storage without losing entries', () => {
    localStorage.setItem(
      'hermes:lookup-history:v1',
      JSON.stringify([
        {
          id: 'legacy-1',
          recordedAt: 1_000,
          bookHash: 'book-1',
          term: 'legacy',
          context: 'Legacy context',
          result: { translation: 'legacy value' },
          mode: 'translation',
          location: 'epubcfi(/6/2:0)',
        },
        {
          id: 'legacy-2',
          recordedAt: 2_000,
          bookHash: 'book-1',
          term: 'older',
          context: 'Older context',
          result: { simpleDefinition: 'fallback' },
          mode: 'dictionary',
        },
      ]),
    );

    const history = getLookupHistoryForBook('book-1');
    const stored = JSON.parse(localStorage.getItem('hermes:lookup-history:v2')!);

    expect(history).toHaveLength(2);
    expect(history[0]).toMatchObject({
      id: 'legacy-2',
      recordedAt: 2_000,
      term: 'older',
      mode: 'dictionary',
    });
    expect(history[1]).toMatchObject({
      id: 'legacy-1',
      recordedAt: 1_000,
      location: 'epubcfi(/6/2:0)',
    });
    expect(stored).toEqual({ version: 2, entries: history });
    expect(localStorage.getItem('hermes:lookup-history:v1')).toBeNull();
  });

  test('ignores blank terms and empty result objects', () => {
    saveLookupHistoryEntry(makeEntry({ term: '   ' }));
    saveLookupHistoryEntry(makeEntry({ result: {} }));

    expect(getLookupHistoryForBook('book-1')).toEqual([]);
  });

  test('caps history size and clears stored entries', () => {
    const nowSpy = vi.spyOn(Date, 'now');

    for (let i = 0; i < 52; i += 1) {
      nowSpy.mockReturnValue(10_000 + i);
      saveLookupHistoryEntry(makeEntry({ term: `term-${i}` }));
    }

    const history = getLookupHistoryForBook('book-1');
    expect(history).toHaveLength(50);
    expect(history[0]!.term).toBe('term-51');
    expect(history[49]!.term).toBe('term-2');

    clearLookupHistory();
    expect(getLookupHistoryForBook('book-1')).toEqual([]);
  });
});
