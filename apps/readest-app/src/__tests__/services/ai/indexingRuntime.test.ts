import { beforeEach, describe, expect, test, vi } from 'vitest';

const { mockIndexBook, mockCancelBookIndexing } = vi.hoisted(() => ({
  mockIndexBook: vi.fn(),
  mockCancelBookIndexing: vi.fn(),
}));

vi.mock('@/services/ai/ragService', () => ({
  indexBook: (...args: unknown[]) => mockIndexBook(...args),
  cancelBookIndexing: (bookHash: string) => mockCancelBookIndexing(bookHash),
}));

import {
  getRunId,
  startBookIndexing,
  subscribeIndexingRuntime,
} from '@/services/ai/indexingRuntime';
import type { AISettings, EmbeddingProgress, IndexResult } from '@/services/ai/types';

type Deferred<T> = {
  promise: Promise<T>;
  resolve: (value: T) => void;
  reject: (error: unknown) => void;
};

function createDeferred<T>(): Deferred<T> {
  let resolve!: (value: T) => void;
  let reject!: (error: unknown) => void;

  const promise = new Promise<T>((res, rej) => {
    resolve = res;
    reject = rej;
  });

  return { promise, resolve, reject };
}

const aiSettings: AISettings = {
  enabled: true,
  providers: [],
  profiles: [],
  activeProfileId: 'default',
  developerMode: false,
  spoilerProtection: true,
  maxContextChunks: 6,
  indexingMode: 'on-demand',
};

const dummyDoc = {
  sections: [],
  toc: [],
};

describe('indexingRuntime', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  test('generates monotonic run ids', async () => {
    mockIndexBook.mockResolvedValue({
      status: 'complete',
      chunksProcessed: 1,
      totalSections: 1,
      skippedSections: 0,
      errorMessages: [],
      durationMs: 1,
    } satisfies IndexResult);

    const runA = startBookIndexing({
      scope: 'reader',
      key: 'book-key',
      bookHash: 'book-a',
      bookDoc: dummyDoc,
      aiSettings,
    });

    const runB = startBookIndexing({
      scope: 'reader',
      key: 'book-key',
      bookHash: 'book-a',
      bookDoc: dummyDoc,
      aiSettings,
    });

    const counterA = Number(runA.runId.split('-').at(-1));
    const counterB = Number(runB.runId.split('-').at(-1));

    expect(counterB).toBeGreaterThan(counterA);

    await runA.promise.catch(() => undefined);
    await runB.promise;
  });

  test('ignores stale progress updates from superseded runs', async () => {
    const progressCallbacks: Array<(progress: EmbeddingProgress) => void> = [];
    const deferredA = createDeferred<IndexResult>();
    const deferredB = createDeferred<IndexResult>();

    mockIndexBook
      .mockImplementationOnce(
        async (
          _doc: unknown,
          _bookHash: string,
          _settings: AISettings,
          onProgress?: (progress: EmbeddingProgress) => void,
        ) => {
          if (onProgress) progressCallbacks.push(onProgress);
          return deferredA.promise;
        },
      )
      .mockImplementationOnce(
        async (
          _doc: unknown,
          _bookHash: string,
          _settings: AISettings,
          onProgress?: (progress: EmbeddingProgress) => void,
        ) => {
          if (onProgress) progressCallbacks.push(onProgress);
          return deferredB.promise;
        },
      );

    const events: Array<{ runId: string; phase: EmbeddingProgress['phase'] }> = [];
    const unsubscribe = subscribeIndexingRuntime((event) => {
      if (event.type === 'progress') {
        events.push({ runId: event.runId, phase: event.progress.phase });
      }
    });

    const runA = startBookIndexing({
      scope: 'reader',
      key: 'book-key',
      bookHash: 'book-a',
      bookDoc: dummyDoc,
      aiSettings,
    });

    const runB = startBookIndexing({
      scope: 'reader',
      key: 'book-key',
      bookHash: 'book-a',
      bookDoc: dummyDoc,
      aiSettings,
    });

    progressCallbacks[0]?.({ current: 1, total: 3, phase: 'chunking' });
    progressCallbacks[1]?.({ current: 2, total: 3, phase: 'embedding' });

    deferredA.resolve({
      status: 'complete',
      chunksProcessed: 3,
      totalSections: 1,
      skippedSections: 0,
      errorMessages: [],
      durationMs: 1,
    });
    deferredB.resolve({
      status: 'complete',
      chunksProcessed: 3,
      totalSections: 1,
      skippedSections: 0,
      errorMessages: [],
      durationMs: 1,
    });

    await runA.promise;
    await runB.promise;

    expect(events).toEqual([{ runId: runB.runId, phase: 'embedding' }]);
    unsubscribe();
  });

  test('propagates cancel via abort signal and clears active run id', async () => {
    const deferred = createDeferred<IndexResult>();
    mockIndexBook.mockImplementation(async () => deferred.promise);

    const events: string[] = [];
    const unsubscribe = subscribeIndexingRuntime((event) => {
      events.push(event.type);
    });

    const controller = new AbortController();
    const run = startBookIndexing({
      scope: 'reader',
      key: 'book-key',
      bookHash: 'book-a',
      bookDoc: dummyDoc,
      aiSettings,
      signal: controller.signal,
    });

    controller.abort();

    expect(mockCancelBookIndexing).toHaveBeenCalledWith('book-a');
    expect(getRunId('reader', 'book-key')).toBeNull();
    expect(events).toContain('cancelled');

    deferred.reject(new Error('Indexing cancelled'));
    await expect(run.promise).rejects.toThrow('Indexing cancelled');
    unsubscribe();
  });

  test('emits progress phase transitions and complete event for active run', async () => {
    let progressCallback: ((progress: EmbeddingProgress) => void) | undefined;
    mockIndexBook.mockImplementation(
      async (
        _doc: unknown,
        _bookHash: string,
        _settings: AISettings,
        onProgress?: (progress: EmbeddingProgress) => void,
      ) => {
        progressCallback = onProgress;
        progressCallback?.({ current: 0, total: 1, phase: 'chunking' });
        progressCallback?.({ current: 1, total: 4, phase: 'embedding' });
        progressCallback?.({ current: 1, total: 1, phase: 'finalizing' });

        return {
          status: 'complete',
          chunksProcessed: 4,
          totalSections: 1,
          skippedSections: 0,
          errorMessages: [],
          durationMs: 1,
        };
      },
    );

    const progressPhases: EmbeddingProgress['phase'][] = [];
    let completed = false;
    const unsubscribe = subscribeIndexingRuntime((event) => {
      if (event.type === 'progress') {
        progressPhases.push(event.progress.phase);
      }
      if (event.type === 'complete') {
        completed = true;
      }
    });

    const run = startBookIndexing({
      scope: 'library',
      key: 'book-hash',
      bookHash: 'book-a',
      bookDoc: dummyDoc,
      aiSettings,
    });

    await run.promise;

    expect(progressPhases).toEqual(['chunking', 'embedding', 'finalizing']);
    expect(completed).toBe(true);
    unsubscribe();
  });
});
