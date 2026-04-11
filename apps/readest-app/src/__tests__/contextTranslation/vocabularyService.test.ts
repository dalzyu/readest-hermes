import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest';
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
import { VOCABULARY_SCHEMA_VERSION } from '@/services/contextTranslation/types';
import {
  saveVocabularyEntry,
  getVocabularyForBook,
  getAllVocabulary,
  deleteVocabularyEntry,
  searchVocabulary,
  markVocabularyEntryReviewed,
  sm2Update,
  getDueVocabularyForBook,
} from '@/services/contextTranslation/vocabularyService';

const mockStore = vi.mocked(aiStore);
const DAY_MS = 24 * 60 * 60 * 1000;
const NOW = 1_700_000_000_000;

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

afterEach(() => {
  vi.restoreAllMocks();
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

  test('persists provided SM-2 fields', async () => {
    mockStore.saveVocabularyEntry.mockResolvedValueOnce(undefined);

    const scheduledEntry = {
      ...sampleEntry,
      dueAt: NOW + DAY_MS,
      intervalDays: 6,
      easeFactor: 2.65,
      repetition: 3,
      lastReviewedAt: NOW,
    };

    const saved = await saveVocabularyEntry(scheduledEntry);

    expect(mockStore.saveVocabularyEntry).toHaveBeenCalledOnce();
    expect(mockStore.saveVocabularyEntry).toHaveBeenCalledWith(
      expect.objectContaining({
        ...scheduledEntry,
        schemaVersion: VOCABULARY_SCHEMA_VERSION,
      }),
    );
    expect(saved).toEqual(expect.objectContaining(scheduledEntry));
  });
});

describe('getVocabularyForBook', () => {
  test('returns upgraded entries for the given book hash', async () => {
    mockStore.getVocabularyByBook.mockResolvedValueOnce([{ ...sampleEntry, mode: undefined }]);

    const result = await getVocabularyForBook('book-xyz');

    expect(mockStore.getVocabularyByBook).toHaveBeenCalledWith('book-xyz');
    expect(result).toHaveLength(1);
    expect(result[0]!).toMatchObject({
      term: 'zhiji',
      mode: 'translation',
      schemaVersion: VOCABULARY_SCHEMA_VERSION,
      dueAt: undefined,
      intervalDays: 0,
      easeFactor: 2.5,
      repetition: 0,
      lastReviewedAt: undefined,
      examples: [],
    });
  });

  test('returns empty array when book has no entries', async () => {
    mockStore.getVocabularyByBook.mockResolvedValueOnce([]);
    const result = await getVocabularyForBook('unknown-book');
    expect(result).toEqual([]);
  });
});

describe('getDueVocabularyForBook', () => {
  test('returns only due entries ordered by dueAt then addedAt', async () => {
    vi.spyOn(Date, 'now').mockReturnValue(NOW);
    mockStore.getVocabularyByBook.mockResolvedValueOnce([
      {
        ...sampleEntry,
        id: 'future-entry',
        dueAt: NOW + DAY_MS,
        addedAt: 30,
      },
      {
        ...sampleEntry,
        id: 'past-entry-2',
        dueAt: NOW - 2 * DAY_MS,
        addedAt: 20,
      },
      {
        ...sampleEntry,
        id: 'undated-entry',
        dueAt: undefined,
        addedAt: 10,
      },
      {
        ...sampleEntry,
        id: 'past-entry-1',
        dueAt: NOW - DAY_MS,
        addedAt: 15,
      },
    ]);

    const result = await getDueVocabularyForBook('book-xyz');

    expect(result.map((entry) => entry.id)).toEqual([
      'undated-entry',
      'past-entry-2',
      'past-entry-1',
    ]);
    expect(result.some((entry) => entry.id === 'future-entry')).toBe(false);
  });
});

describe('sm2Update', () => {
  test('advances repetition and interval on a grade 4 pass', async () => {
    vi.spyOn(Date, 'now').mockReturnValue(NOW);

    const updated = sm2Update(
      {
        ...sampleEntry,
        reviewCount: 3,
        repetition: 2,
        intervalDays: 6,
        easeFactor: 2.5,
        lastReviewedAt: NOW - DAY_MS,
        dueAt: NOW - DAY_MS,
      },
      4,
    );

    expect(updated.reviewCount).toBe(4);
    expect(updated.repetition).toBe(3);
    expect(updated.intervalDays).toBeGreaterThan(6);
    expect(updated.easeFactor).toBeCloseTo(2.5, 5);
    expect(updated.lastReviewedAt).toBe(NOW);
    expect(updated.dueAt).toBe(NOW + updated.intervalDays! * DAY_MS);
  });

  test('increases ease factor on a grade 5 pass', () => {
    vi.spyOn(Date, 'now').mockReturnValue(NOW);

    const updated = sm2Update(
      {
        ...sampleEntry,
        reviewCount: 2,
        repetition: 2,
        intervalDays: 6,
        easeFactor: 2.5,
        lastReviewedAt: NOW - DAY_MS,
        dueAt: NOW - DAY_MS,
      },
      5,
    );

    expect(updated.easeFactor).toBeGreaterThan(2.5);
    expect(updated.repetition).toBe(3);
    expect(updated.intervalDays).toBeGreaterThan(6);
    expect(updated.dueAt).toBe(NOW + updated.intervalDays! * DAY_MS);
  });

  test('resets repetition and reduces ease factor on a grade 1 failure', () => {
    vi.spyOn(Date, 'now').mockReturnValue(NOW);

    const updated = sm2Update(
      {
        ...sampleEntry,
        reviewCount: 7,
        repetition: 4,
        intervalDays: 12,
        easeFactor: 2.4,
        lastReviewedAt: NOW - DAY_MS,
        dueAt: NOW - DAY_MS,
      },
      1,
    );

    expect(updated.reviewCount).toBe(8);
    expect(updated.repetition).toBe(0);
    expect(updated.intervalDays).toBe(1);
    expect(updated.easeFactor).toBeCloseTo(1.86, 2); // SM-2: EF decreases on failure
    expect(updated.lastReviewedAt).toBe(NOW);
    expect(updated.dueAt).toBe(NOW + DAY_MS);
  });

  test('clamps the ease factor to the SM-2 minimum after repeated failures', () => {
    vi.spyOn(Date, 'now').mockReturnValue(NOW);

    let current: VocabularyEntry = {
      ...sampleEntry,
      reviewCount: 0,
      repetition: 3,
      intervalDays: 10,
      easeFactor: 1.4,
      lastReviewedAt: NOW - DAY_MS,
      dueAt: NOW - DAY_MS,
    };

    for (let i = 0; i < 4; i += 1) {
      current = sm2Update(current, 0);
    }

    expect(current.easeFactor).toBe(1.3);
    expect(current.repetition).toBe(0);
    expect(current.intervalDays).toBe(1);
    expect(current.dueAt).toBe(NOW + DAY_MS);
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
  test('increments reviewCount and schedules the next review by default', async () => {
    vi.spyOn(Date, 'now').mockReturnValue(NOW);
    mockStore.saveVocabularyEntry.mockResolvedValueOnce(undefined);

    const reviewed = await markVocabularyEntryReviewed(sampleEntry);

    expect(mockStore.saveVocabularyEntry).toHaveBeenCalledOnce();
    expect(mockStore.saveVocabularyEntry).toHaveBeenCalledWith(
      expect.objectContaining({
        ...sampleEntry,
        reviewCount: 1,
        repetition: 1,
        intervalDays: 1,
        dueAt: NOW + DAY_MS,
        lastReviewedAt: NOW,
        schemaVersion: VOCABULARY_SCHEMA_VERSION,
        examples: [],
      }),
    );
    expect(reviewed).toEqual(
      expect.objectContaining({
        ...sampleEntry,
        reviewCount: 1,
        repetition: 1,
        intervalDays: 1,
        dueAt: NOW + DAY_MS,
        lastReviewedAt: NOW,
        schemaVersion: VOCABULARY_SCHEMA_VERSION,
        examples: [],
      }),
    );
  });
});
