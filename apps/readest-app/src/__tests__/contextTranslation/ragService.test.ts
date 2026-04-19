import { beforeEach, describe, expect, test, vi } from 'vitest';

import type { BookDocType } from '@/services/ai/ragService';
import { DEFAULT_AI_SETTINGS } from '@/services/ai/constants';
import type { AISettings, EmbeddingProgress } from '@/services/ai/types';

// --- Mocks ---

vi.mock('@/services/ai/storage/aiStore', () => ({
  aiStore: {
    isIndexed: vi.fn(),
    saveChunks: vi.fn(),
    saveMeta: vi.fn(),
  },
}));

vi.mock('@/services/ai/providers', () => ({
  getProviderForTask: vi.fn(),
}));

vi.mock('ai', () => ({
  embedMany: vi.fn(),
  embed: vi.fn(),
}));

vi.mock('@/services/ai/logger', () => ({
  aiLogger: {
    rag: {
      isIndexed: vi.fn(),
      indexStart: vi.fn(),
      indexProgress: vi.fn(),
      indexComplete: vi.fn(),
      indexError: vi.fn(),
    },
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
    },
  },
}));

vi.mock('@/services/ai/utils/retry', () => ({
  withRetryAndTimeout: vi.fn((fn: () => Promise<unknown>) => fn()),
  AI_TIMEOUTS: { EMBEDDING_BATCH: 30_000 },
  AI_RETRY_CONFIGS: { EMBEDDING: {} },
}));

vi.mock('@/services/ai/utils/chunker', () => ({
  extractTextFromDocument: vi.fn((doc: Document) => doc.body?.textContent ?? ''),
  chunkSection: vi.fn(
    (_doc: Document, sectionIndex: number, _chapterTitle: string, bookHash: string) => [
      {
        id: `${bookHash}-${sectionIndex}-0`,
        bookHash,
        sectionIndex,
        chapterTitle: `Section ${sectionIndex + 1}`,
        text: `Chunk from section ${sectionIndex}`,
        pageNumber: sectionIndex,
      },
    ],
  ),
}));

import { aiStore } from '@/services/ai/storage/aiStore';
import { getProviderForTask } from '@/services/ai/providers';
import { embedMany } from 'ai';
import { indexBook } from '@/services/ai/ragService';

const mockAiStore = vi.mocked(aiStore);
const mockGetProvider = vi.mocked(getProviderForTask);
const mockEmbedMany = vi.mocked(embedMany);

function makeDomDocument(text: string): Document {
  const doc = new DOMParser().parseFromString(`<body>${text}</body>`, 'text/html');
  return doc;
}

function makeSection(id: string, text: string, size?: number) {
  return {
    id,
    size: size ?? text.length,
    linear: 'yes',
    createDocument: () => Promise.resolve(makeDomDocument(text)),
  };
}

const baseSettings: AISettings = {
  ...DEFAULT_AI_SETTINGS,
  enabled: true,
  providers: [
    {
      id: 'p1',
      name: 'Test',
      providerType: 'openai',
      baseUrl: 'http://localhost',
      models: [
        { id: 'gpt-4', kind: 'chat' },
        { id: 'text-embedding-3-small', kind: 'embedding' },
      ],
    },
  ],
  spoilerProtection: false,
  maxContextChunks: 5,
  indexingMode: 'on-demand',
};

beforeEach(() => {
  vi.clearAllMocks();

  mockGetProvider.mockReturnValue({
    provider: {
      id: 'provider-id',
      getEmbeddingModel: () => ({ maxEmbeddingsPerCall: 100 }),
    },
    modelId: 'text-embedding-3-small',
    inferenceParams: {},
    config: baseSettings.providers[0],
  } as never);

  mockEmbedMany.mockResolvedValue({
    embeddings: [[0.1, 0.2, 0.3]],
    usage: { tokens: 10 },
  } as never);

  mockAiStore.isIndexed.mockResolvedValue(false);
  mockAiStore.saveChunks.mockResolvedValue(undefined);
  mockAiStore.saveMeta.mockResolvedValue(undefined);
});

describe('indexBook', () => {
  test('already-indexed book returns already-indexed status', async () => {
    mockAiStore.isIndexed.mockResolvedValueOnce(true);

    const bookDoc: BookDocType = {
      sections: [
        makeSection(
          's1',
          'Some long enough text for testing purposes that exceeds the minimum character threshold for indexing.',
        ),
      ],
      metadata: { title: 'Test Book', author: 'Author' },
    };

    const result = await indexBook(bookDoc, 'hash-abc', baseSettings);

    expect(result.status).toBe('already-indexed');
    expect(result.chunksProcessed).toBe(0);
    expect(result.durationMs).toBe(0);
  });

  test('zero-chunk indexing returns empty status', async () => {
    // All sections have text < 100 chars, so all will be skipped → zero chunks
    const bookDoc: BookDocType = {
      sections: [makeSection('s1', 'Short.'), makeSection('s2', 'Also tiny.')],
      metadata: { title: 'Empty Book', author: 'Author' },
    };

    const result = await indexBook(bookDoc, 'hash-empty', baseSettings);

    expect(result.status).toBe('empty');
    expect(result.chunksProcessed).toBe(0);
    expect(result.totalSections).toBe(2);
    expect(result.skippedSections).toBe(2);
    expect(mockAiStore.saveChunks).not.toHaveBeenCalled();
  });

  test('sections < 100 chars are counted as skipped', async () => {
    const longText = 'A'.repeat(200);
    const bookDoc: BookDocType = {
      sections: [
        makeSection('s1', 'tiny', 4),
        makeSection('s2', longText, 200),
        makeSection('s3', 'also small', 10),
      ],
      metadata: { title: 'Mixed Book', author: 'Author' },
    };

    const result = await indexBook(bookDoc, 'hash-mixed', baseSettings);

    expect(result.status).toBe('complete');
    expect(result.skippedSections).toBe(2);
    expect(result.totalSections).toBe(3);
    expect(result.chunksProcessed).toBeGreaterThan(0);
  });

  test('successful indexing returns complete status with correct counts', async () => {
    const longText = 'A'.repeat(200);
    const bookDoc: BookDocType = {
      sections: [makeSection('s1', longText, 200), makeSection('s2', longText, 200)],
      toc: [{ id: 0, label: 'Chapter 1' }],
      metadata: { title: 'Full Book', author: 'Test Author' },
    };

    const progressUpdates: EmbeddingProgress[] = [];
    const onProgress = (p: EmbeddingProgress) => progressUpdates.push(p);

    const result = await indexBook(bookDoc, 'hash-full', baseSettings, onProgress);

    expect(result.status).toBe('complete');
    expect(result.totalSections).toBe(2);
    expect(result.skippedSections).toBe(0);
    expect(result.chunksProcessed).toBeGreaterThan(0);
    expect(result.durationMs).toBeGreaterThanOrEqual(0);
    expect(result.errorMessages).toEqual([]);

    expect(mockAiStore.saveChunks).toHaveBeenCalledOnce();
    expect(mockAiStore.saveMeta).toHaveBeenCalledOnce();

    // Progress should have been reported
    expect(progressUpdates.length).toBeGreaterThan(0);
  });
});
