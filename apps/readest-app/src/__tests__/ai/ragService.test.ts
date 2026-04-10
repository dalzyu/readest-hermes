import { beforeEach, describe, expect, test, vi } from 'vitest';
import type { AISettings, TextChunk } from '@/services/ai/types';
import { DEFAULT_AI_SETTINGS } from '@/services/ai/constants';

const {
  mockEmbed,
  mockEmbedMany,
  mockHybridSearch,
  mockIsIndexed,
  mockSaveChunks,
  mockSaveBM25Index,
  mockSaveMeta,
  mockGetAIProvider,
} = vi.hoisted(() => ({
  mockEmbed: vi.fn(),
  mockEmbedMany: vi.fn(),
  mockHybridSearch: vi.fn(),
  mockIsIndexed: vi.fn(),
  mockSaveChunks: vi.fn(),
  mockSaveBM25Index: vi.fn(),
  mockSaveMeta: vi.fn(),
  mockGetAIProvider: vi.fn(),
}));

vi.mock('ai', () => ({
  embed: mockEmbed,
  embedMany: mockEmbedMany,
}));

vi.mock('@/services/ai/storage/aiStore', () => ({
  aiStore: {
    hybridSearch: mockHybridSearch,
    isIndexed: mockIsIndexed,
    saveChunks: mockSaveChunks,
    saveBM25Index: mockSaveBM25Index,
    saveMeta: mockSaveMeta,
  },
}));

vi.mock('@/services/ai/providers', () => ({
  getAIProvider: mockGetAIProvider,
}));

vi.mock('@/services/ai/logger', () => ({
  aiLogger: {
    chunker: {
      section: vi.fn(),
      complete: vi.fn(),
      error: vi.fn(),
    },
    embedding: {
      start: vi.fn(),
      batch: vi.fn(),
      complete: vi.fn(),
      error: vi.fn(),
    },
    store: {
      saveChunks: vi.fn(),
      saveBM25: vi.fn(),
      saveMeta: vi.fn(),
      error: vi.fn(),
    },
    rag: {
      indexStart: vi.fn(),
      indexProgress: vi.fn(),
      indexComplete: vi.fn(),
      indexError: vi.fn(),
      isIndexed: vi.fn(),
    },
    search: {
      query: vi.fn(),
      hybridResults: vi.fn(),
    },
  },
}));

vi.mock('@/services/ai/utils/chunker', () => ({
  extractTextFromDocument: vi.fn(() => 'x'.repeat(1000)),
  chunkSection: vi.fn(
    (
      _doc: Document,
      sectionIndex: number,
      chapterTitle: string,
      bookHash: string,
      cumulativeSizeBeforeSection: number,
    ): TextChunk[] =>
      Array.from({ length: 205 }, (_, chunkIndex) => ({
        id: `${bookHash}-${sectionIndex}-${chunkIndex}`,
        bookHash,
        sectionIndex,
        chapterTitle,
        text: `chunk ${chunkIndex}`,
        pageNumber: Math.floor(cumulativeSizeBeforeSection / 1500),
      })),
  ),
}));

import { boundedHybridSearch, indexBook } from '@/services/ai/ragService';

describe('ragService', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockIsIndexed.mockResolvedValue(false);
    mockSaveChunks.mockResolvedValue(undefined);
    mockSaveBM25Index.mockResolvedValue(undefined);
    mockSaveMeta.mockResolvedValue(undefined);
    mockGetAIProvider.mockReturnValue({
      getEmbeddingModel: () => ({ modelId: 'test-embedding-model' }),
    });
    mockEmbed.mockResolvedValue({ embedding: [0.1, 0.2] });
    mockEmbedMany.mockImplementation(async ({ values }: { values: string[] }) => ({
      embeddings: values.map((_value, index) => [index, index + 1]),
    }));
    mockHybridSearch.mockResolvedValue([]);
  });

  test('indexes large books in embedding batches and reports incremental progress', async () => {
    const settings: AISettings = {
      ...DEFAULT_AI_SETTINGS,
      enabled: true,
      provider: 'openai-compatible',
      openAICompatibleModel: 'test-llm',
      openAICompatibleEmbeddingModel: 'embeddinggemma',
    };
    const bookDoc = {
      metadata: { title: 'Large Book', author: 'Tester' },
      sections: [
        {
          id: 'section-1',
          size: 100_000,
          linear: 'yes',
          createDocument: async () => document.implementation.createHTMLDocument('section'),
        },
      ],
      toc: [{ id: 0, label: 'Chapter 1' }],
    };
    const progressUpdates: { current: number; total: number; phase: string }[] = [];

    await indexBook(bookDoc, 'book-hash', settings, (progress) => {
      progressUpdates.push(progress);
    });

    expect(mockEmbedMany).toHaveBeenCalledTimes(3);
    expect(mockEmbedMany.mock.calls.map(([args]) => args.values.length)).toEqual([100, 100, 5]);

    const embeddingProgress = progressUpdates.filter((progress) => progress.phase === 'embedding');
    expect(embeddingProgress).toEqual([
      { current: 0, total: 205, phase: 'embedding' },
      { current: 100, total: 205, phase: 'embedding' },
      { current: 200, total: 205, phase: 'embedding' },
      { current: 205, total: 205, phase: 'embedding' },
    ]);
  });

  test('passes page bounds through to aiStore hybrid search', async () => {
    const settings: AISettings = DEFAULT_AI_SETTINGS;

    await boundedHybridSearch('book-hash', 'query text', settings, 3, { maxPage: 7, minPage: 2 });

    expect(mockHybridSearch).toHaveBeenCalledWith('book-hash', [0.1, 0.2], 'query text', 3, {
      maxPage: 7,
      minPage: 2,
    });
  });
});
