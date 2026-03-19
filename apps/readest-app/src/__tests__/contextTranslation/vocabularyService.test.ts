import { describe, test, expect, vi, beforeEach } from 'vitest';
import type { VocabularyEntry } from '@/services/contextTranslation/types';

// Mock aiStore so tests don't touch IndexedDB
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
} from '@/services/contextTranslation/vocabularyService';

const mockStore = vi.mocked(aiStore);

const sampleEntry: VocabularyEntry = {
  id: 'abc-123',
  bookHash: 'book-xyz',
  term: '知己',
  context: 'He finally found a true 知己 among his companions.',
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
      term: '知己',
      context: 'some context',
      result: { translation: 'close friend' },
    });

    expect(mockStore.saveVocabularyEntry).toHaveBeenCalledOnce();
    const arg = mockStore.saveVocabularyEntry.mock.calls[0]![0] as VocabularyEntry;
    expect(arg.id).toBeTruthy();
    expect(arg.addedAt).toBeGreaterThan(0);
    expect(arg.reviewCount).toBe(0);
    expect(arg.term).toBe('知己');
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
  test('returns entries for the given book hash', async () => {
    mockStore.getVocabularyByBook.mockResolvedValueOnce([sampleEntry]);

    const result = await getVocabularyForBook('book-xyz');

    expect(mockStore.getVocabularyByBook).toHaveBeenCalledWith('book-xyz');
    expect(result).toHaveLength(1);
    expect(result[0]!.term).toBe('知己');
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
  test('returns entries whose term contains the query (case-insensitive)', async () => {
    mockStore.searchVocabulary.mockResolvedValueOnce([sampleEntry]);

    const result = await searchVocabulary('知己');
    expect(mockStore.searchVocabulary).toHaveBeenCalledWith('知己');
    expect(result[0]!.term).toBe('知己');
  });
});
