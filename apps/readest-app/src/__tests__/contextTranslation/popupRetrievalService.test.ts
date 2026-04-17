import { beforeEach, describe, expect, test, vi } from 'vitest';

const {
  mockGetPopupLocalContext,
  mockBoundedHybridSearch,
  mockHybridSearch,
  mockGetPriorVolumes,
  mockGetSeriesForBook,
  mockIsIndexed,
} = vi.hoisted(() => ({
  mockGetPopupLocalContext: vi.fn(),
  mockBoundedHybridSearch: vi.fn(),
  mockHybridSearch: vi.fn(),
  mockGetPriorVolumes: vi.fn(),
  mockGetSeriesForBook: vi.fn(),
  mockIsIndexed: vi.fn(),
}));

vi.mock('@/services/contextTranslation/pageContextService', () => ({
  getPopupLocalContext: mockGetPopupLocalContext,
}));

vi.mock('@/services/ai/ragService', () => ({
  boundedHybridSearch: mockBoundedHybridSearch,
  hybridSearch: mockHybridSearch,
}));

vi.mock('@/services/contextTranslation/seriesService', () => ({
  getPriorVolumes: mockGetPriorVolumes,
  getSeriesForBook: mockGetSeriesForBook,
}));

vi.mock('@/services/ai/storage/aiStore', () => ({
  aiStore: {
    isIndexed: mockIsIndexed,
  },
}));

import type { AISettings, ScoredChunk } from '@/services/ai/types';
import { DEFAULT_AI_SETTINGS } from '@/services/ai/constants';
import { DEFAULT_CONTEXT_TRANSLATION_SETTINGS } from '@/services/contextTranslation/defaults';
import {
  buildPopupContextBundle,
  invalidatePageCache,
} from '@/services/contextTranslation/popupRetrievalService';

function makeChunk(bookHash: string, text: string, score = 0.9): ScoredChunk {
  return {
    id: `${bookHash}-${text}`,
    bookHash,
    sectionIndex: 0,
    chapterTitle: 'Chapter 1',
    text,
    pageNumber: 1,
    score,
    searchMethod: 'hybrid',
  };
}

describe('buildPopupContextBundle', () => {
  const aiSettings: AISettings = DEFAULT_AI_SETTINGS;

  beforeEach(() => {
    vi.clearAllMocks();
    invalidatePageCache();
    mockGetPopupLocalContext.mockResolvedValue({
      localPastContext: 'Past context ending at the selected text.',
      localFutureBuffer: 'A few words ahead.',
      windowStartPage: 4,
    });
    mockBoundedHybridSearch.mockResolvedValue([]);
    mockHybridSearch.mockResolvedValue([]);
    mockGetPriorVolumes.mockResolvedValue([]);
    mockGetSeriesForBook.mockResolvedValue(null);
    mockIsIndexed.mockResolvedValue(false);
  });

  test('returns local-only when the current volume is not indexed', async () => {
    mockGetPriorVolumes.mockResolvedValue([{ bookHash: 'vol-1', volumeIndex: 1, label: 'Vol. 1' }]);
    mockGetSeriesForBook.mockResolvedValue({
      id: 'series-1',
      name: 'Series',
      volumes: [
        { bookHash: 'vol-1', volumeIndex: 1, label: 'Vol. 1' },
        { bookHash: 'vol-2', volumeIndex: 2, label: 'Vol. 2' },
      ],
      createdAt: 1,
      updatedAt: 1,
    });
    mockIsIndexed.mockImplementation(async (bookHash: string) => bookHash === 'vol-1');

    const bundle = await buildPopupContextBundle({
      bookKey: 'vol-2-hash',
      bookHash: 'vol-2',
      currentPage: 6,
      selectedText: '殿下',
      settings: DEFAULT_CONTEXT_TRANSLATION_SETTINGS,
      aiSettings,
    });

    expect(bundle.retrievalStatus).toBe('local-only');
    expect(bundle.sameBookChunks).toEqual([]);
    expect(bundle.priorVolumeChunks).toEqual([]);
    expect(bundle.retrievalHints.missingLocalIndex).toBe(true);
  });

  test('returns same-book and prior-volume memory when eligible volumes are indexed', async () => {
    mockIsIndexed.mockResolvedValue(true);
    mockGetSeriesForBook.mockResolvedValue({
      id: 'series-1',
      name: 'Series',
      volumes: [
        { bookHash: 'vol-1', volumeIndex: 1, label: 'Vol. 1' },
        { bookHash: 'vol-2', volumeIndex: 2, label: 'Vol. 2' },
        { bookHash: 'vol-3', volumeIndex: 3, label: 'Vol. 3' },
      ],
      createdAt: 1,
      updatedAt: 1,
    });
    mockBoundedHybridSearch.mockResolvedValue([
      makeChunk('vol-3', 'Earlier in this book the title marked deference.'),
    ]);
    mockGetPriorVolumes.mockResolvedValue([
      { bookHash: 'vol-1', volumeIndex: 1, label: 'Vol. 1' },
      { bookHash: 'vol-2', volumeIndex: 2, label: 'Vol. 2' },
    ]);
    mockHybridSearch
      .mockResolvedValueOnce([makeChunk('vol-1', 'Volume one introduced the title.', 0.4)])
      .mockResolvedValueOnce([makeChunk('vol-2', 'Volume two repeated the title.', 0.8)]);

    const bundle = await buildPopupContextBundle({
      bookKey: 'vol-3-hash',
      bookHash: 'vol-3',
      currentPage: 6,
      selectedText: '殿下',
      settings: DEFAULT_CONTEXT_TRANSLATION_SETTINGS,
      aiSettings,
    });

    expect(bundle.retrievalStatus).toBe('cross-volume');
    expect(bundle.sameBookChunks[0]).toContain('Earlier in this book');
    expect(bundle.priorVolumeChunks[0]).toContain('Volume two repeated the title.');
    expect(bundle.retrievalHints.missingLocalIndex).toBe(false);
    expect(bundle.retrievalHints.missingPriorVolumes).toEqual([]);
    expect(mockBoundedHybridSearch).toHaveBeenCalledWith(
      'vol-3',
      expect.any(String),
      aiSettings,
      DEFAULT_CONTEXT_TRANSLATION_SETTINGS.sameBookChunkCount,
      { maxPage: 3 },
    );
  });

  test('filters the current sentence out of same-book retrieval chunks', async () => {
    mockIsIndexed.mockResolvedValue(true);
    mockGetPopupLocalContext.mockResolvedValue({
      localPastContext: 'Earlier setup. He remained by his side',
      localFutureBuffer: ' through the night. Another sentence.',
      windowStartPage: 4,
    });
    mockBoundedHybridSearch.mockResolvedValue([
      makeChunk('vol-3', 'He remained by his side through the night.'),
      makeChunk('vol-3', 'Later, the guard stepped away.'),
    ]);

    const bundle = await buildPopupContextBundle({
      bookKey: 'vol-3-hash',
      bookHash: 'vol-3',
      currentPage: 6,
      selectedText: 'side',
      settings: DEFAULT_CONTEXT_TRANSLATION_SETTINGS,
      aiSettings,
    });

    expect(bundle.sameBookChunks).toHaveLength(1);
    expect(bundle.sameBookChunks[0]).toContain('Later, the guard stepped away.');
    expect(bundle.sameBookChunks[0]).not.toContain('He remained by his side through the night.');
  });
});
