import { beforeEach, describe, expect, test, vi } from 'vitest';
import type { AISettings, TextChunk } from '@/services/ai/types';
import { DEFAULT_AI_SETTINGS } from '@/services/ai/constants';

const {
  mockEmbed,
  mockEmbedMany,
  mockVectorSearch,
  mockIsIndexed,
  mockSaveChunks,
  mockSaveMeta,
  mockGetAIProvider,
} = vi.hoisted(() => ({
  mockEmbed: vi.fn(),
  mockEmbedMany: vi.fn(),
  mockVectorSearch: vi.fn(),
  mockIsIndexed: vi.fn(),
  mockSaveChunks: vi.fn(),
  mockSaveMeta: vi.fn(),
  mockGetAIProvider: vi.fn(),
}));

vi.mock('ai', () => ({
  embed: mockEmbed,
  embedMany: mockEmbedMany,
}));

vi.mock('@/services/ai/storage/aiStore', () => ({
  aiStore: {
    vectorSearch: mockVectorSearch,
    isIndexed: mockIsIndexed,
    saveChunks: mockSaveChunks,
    saveMeta: mockSaveMeta,
  },
}));

vi.mock('@/services/ai/providers', () => ({
  getProviderForTask: mockGetAIProvider,
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
      vectorResults: vi.fn(),
      rerankedResults: vi.fn(),
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

import { indexBook, vectorSearch } from '@/services/ai/ragService';

describe('ragService', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockIsIndexed.mockResolvedValue(false);
    mockSaveChunks.mockResolvedValue(undefined);
    mockSaveMeta.mockResolvedValue(undefined);
    mockGetAIProvider.mockReturnValue({
      provider: {
        id: 'provider-id',
        getEmbeddingModel: () => ({ modelId: 'test-embedding-model' }),
      },
      modelId: 'embeddinggemma',
      inferenceParams: {},
      config: {
        id: 'oc-test',
        name: 'OpenAI-Compatible',
        providerType: 'openai',
        baseUrl: 'http://127.0.0.1:8080',
        models: [
          { id: 'test-llm', kind: 'chat' },
          { id: 'embeddinggemma', kind: 'embedding' },
        ],
      },
    });
    mockEmbed.mockResolvedValue({ embedding: [0.1, 0.2] });
    mockEmbedMany.mockImplementation(async ({ values }: { values: string[] }) => ({
      embeddings: values.map((_value, index) => [index, index + 1]),
    }));
    mockVectorSearch.mockResolvedValue([]);
  });

  test('indexes large books in embedding batches and reports incremental progress', async () => {
    const settings: AISettings = {
      ...DEFAULT_AI_SETTINGS,
      enabled: true,
      providers: [
        {
          id: 'oc-test',
          name: 'OpenAI-Compatible',
          providerType: 'openai',
          baseUrl: 'http://127.0.0.1:8080',
          models: [
            { id: 'test-llm', kind: 'chat' },
            { id: 'embeddinggemma', kind: 'embedding' },
          ],
        },
      ],
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

    expect(progressUpdates).toContainEqual({ current: 1, total: 1, phase: 'finalizing' });
    expect(mockSaveChunks).toHaveBeenCalledTimes(1);
    expect(mockSaveMeta).toHaveBeenCalledTimes(1);
  });

  test('accepts page bounds for vector lookup', async () => {
    const settings: AISettings = DEFAULT_AI_SETTINGS;

    const results = await vectorSearch(
      'book-hash',
      'query text',
      settings,
      3,
      { maxPage: 7, minPage: 2 },
      'query text',
    );

    expect(Array.isArray(results)).toBe(true);
  });

  test('returns partial when some sections fail but later sections still index', async () => {
    const settings: AISettings = {
      ...DEFAULT_AI_SETTINGS,
      enabled: true,
      providers: [
        {
          id: 'oc-test',
          name: 'OpenAI-Compatible',
          providerType: 'openai',
          baseUrl: 'http://127.0.0.1:8080',
          models: [
            { id: 'test-llm', kind: 'chat' },
            { id: 'embeddinggemma', kind: 'embedding' },
          ],
        },
      ],
    };

    const bookDoc = {
      metadata: { title: 'Partially Broken Book', author: 'Tester' },
      sections: [
        {
          id: 'section-1',
          size: 100_000,
          linear: 'yes',
          createDocument: async () => {
            throw new Error('section parse failed');
          },
        },
        {
          id: 'section-2',
          size: 100_000,
          linear: 'yes',
          createDocument: async () => document.implementation.createHTMLDocument('section'),
        },
      ],
      toc: [
        { id: 0, label: 'Chapter 1' },
        { id: 1, label: 'Chapter 2' },
      ],
    };

    const result = await indexBook(bookDoc, 'partial-book', settings);

    expect(result.status).toBe('partial');
    expect(result.errorMessages).toEqual(['Section 0: section parse failed']);
    expect(mockSaveChunks).toHaveBeenCalledTimes(1);
    expect(mockSaveMeta).toHaveBeenCalledTimes(1);
  });
});
