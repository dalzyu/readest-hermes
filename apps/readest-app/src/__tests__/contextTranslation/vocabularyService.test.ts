import { describe, test, expect, vi, beforeEach } from 'vitest';
import type { VocabularyEntry } from '@/services/contextTranslation/types';

vi.mock('@/services/ai/storage/aiStore', () => ({
  aiStore: {
    saveVocabularyEntry: vi.fn(),
    getVocabularyByBook: vi.fn(),
    getAllVocabulary: vi.fn(),
    deleteVocabularyEntry: vi.fn(),
    searchVocabulary: vi.fn(),
  },
}));

import { aiStore } from '@/services/ai/storage/aiStore';
import {
  saveVocabularyEntry,
  getVocabularyForBook,
  getAllVocabulary,
  deleteVocabularyEntry,
  searchVocabulary,
  markVocabularyEntryReviewed,
} from '@/services/contextTranslation/vocabularyService';
import { VOCABULARY_SCHEMA_VERSION } from '@/services/contextTranslation/types';

const mockStore = vi.mocked(aiStore);

const sampleEntry: VocabularyEntry = {
  id: 'abc-123',
  bookHash: 'book-xyz',
  term: 'zhiji',
  context: 'He finally found a true confidant among his companions.',
  result: { translation: 'close friend', contextualMeaning: 'A soulmate who understands you.' },
  addedAt: 1700000000000,
  reviewCount: 0,
};

beforeEach(() => {
  vi.clearAllMocks();
});

describe('saveVocabularyEntry', () => {
  test('generates an id and timestamp if not provided, then saves', async () => {
    mockStore.saveVocabularyEntry.mockResolvedValueOnce(undefined);

    const saved = await saveVocabularyEntry({
      bookHash: 'book-xyz',
      term: 'zhiji',
      context: 'some context',
      result: { translation: 'close friend' },
    });

    expect(mockStore.saveVocabularyEntry).toHaveBeenCalledOnce();
    const arg = mockStore.saveVocabularyEntry.mock.calls[0]![0] as VocabularyEntry;
    expect(arg.id).toBeTruthy();
    expect(arg.addedAt).toBeGreaterThan(0);
    expect(arg.reviewCount).toBe(0);
    expect(arg.term).toBe('zhiji');
    expect(saved.id).toBe(arg.id);
  });

  test('saves with provided id and timestamp when given', async () => {
    mockStore.saveVocabularyEntry.mockResolvedValueOnce(undefined);

    await saveVocabularyEntry(sampleEntry);

    const arg = mockStore.saveVocabularyEntry.mock.calls[0]![0] as VocabularyEntry;
    expect(arg.id).toBe('abc-123');
    expect(arg.addedAt).toBe(1700000000000);
  });
});

describe('getVocabularyForBook', () => {
  test('returns upgraded entries for the given book hash', async () => {
    mockStore.getVocabularyByBook.mockResolvedValueOnce([{ ...sampleEntry, mode: undefined }]);

    const result = await getVocabularyForBook('book-xyz');

    expect(mockStore.getVocabularyByBook).toHaveBeenCalledWith('book-xyz');
    expect(result).toHaveLength(1);
    expect(result[0]!.term).toBe('zhiji');
    expect(result[0]!.mode).toBe('translation');
    expect(result[0]!.schemaVersion).toBe(VOCABULARY_SCHEMA_VERSION);
  });

  test('returns empty array when book has no entries', async () => {
    mockStore.getVocabularyByBook.mockResolvedValueOnce([]);
    const result = await getVocabularyForBook('unknown-book');
    expect(result).toEqual([]);
  });
});

describe('getAllVocabulary', () => {
  test('returns all entries across books', async () => {
    const entries = [sampleEntry, { ...sampleEntry, id: 'def-456', bookHash: 'other-book' }];
    mockStore.getAllVocabulary.mockResolvedValueOnce(entries);

    const result = await getAllVocabulary();
    expect(result).toHaveLength(2);
  });
});

describe('deleteVocabularyEntry', () => {
  test('delegates deletion to the store', async () => {
    mockStore.deleteVocabularyEntry.mockResolvedValueOnce(undefined);
    await deleteVocabularyEntry('abc-123');
    expect(mockStore.deleteVocabularyEntry).toHaveBeenCalledWith('abc-123');
  });
});

describe('searchVocabulary', () => {
  test('returns entries whose term contains the query', async () => {
    mockStore.searchVocabulary.mockResolvedValueOnce([sampleEntry]);

    const result = await searchVocabulary('zhi');
    expect(mockStore.searchVocabulary).toHaveBeenCalledWith('zhi');
    expect(result[0]!.term).toBe('zhiji');
  });
});

describe('saveVocabularyEntry with examples', () => {
  test('preserves example annotation linkage by exampleId during save and load', async () => {
    mockStore.saveVocabularyEntry.mockResolvedValueOnce(undefined);

    const structuredEntry = {
      bookHash: 'book-xyz',
      term: 'zhiji',
      context: 'He found a true confidant.',
      result: { translation: 'close friend' },
      mode: 'translation' as const,
      examples: [{ exampleId: 'ex-abc', text: 'He found a true confidant.' }],
    };

    const entry = await saveVocabularyEntry(structuredEntry);
    expect(entry.examples![0]!.exampleId).toBeDefined();
    expect(entry.examples![0]!.exampleId).toBe('ex-abc');
  });
});

describe('markVocabularyEntryReviewed', () => {
  test('increments reviewCount without changing the entry identity or saved data', async () => {
    mockStore.saveVocabularyEntry.mockResolvedValueOnce(undefined);

    const reviewed = await markVocabularyEntryReviewed(sampleEntry);

    expect(mockStore.saveVocabularyEntry).toHaveBeenCalledOnce();
    expect(mockStore.saveVocabularyEntry).toHaveBeenCalledWith(
      expect.objectContaining({
        ...sampleEntry,
        reviewCount: 1,
        mode: 'translation',
        schemaVersion: VOCABULARY_SCHEMA_VERSION,
        examples: [],
      }),
    );
    expect(reviewed).toEqual(
      expect.objectContaining({
        ...sampleEntry,
        reviewCount: 1,
        mode: 'translation',
        schemaVersion: VOCABULARY_SCHEMA_VERSION,
        examples: [],
      }),
    );
  });
});
