import { beforeEach, describe, expect, test, vi } from 'vitest';

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
    nowSpy.mockRestore();
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
    nowSpy.mockRestore();
  });
});
