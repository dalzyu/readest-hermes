import { cancelBookIndexing, indexBook, type BookDocType } from './ragService';
import type { AISettings, EmbeddingProgress, IndexResult } from './types';

export type IndexingScope = 'reader' | 'library';

export interface StartBookIndexingOptions {
  scope: IndexingScope;
  key: string;
  bookHash: string;
  bookDoc: BookDocType;
  aiSettings: AISettings;
  signal?: AbortSignal;
}

export type IndexingRuntimeEvent =
  | {
      type: 'start';
      runId: string;
      scope: IndexingScope;
      key: string;
      bookHash: string;
    }
  | {
      type: 'progress';
      runId: string;
      scope: IndexingScope;
      key: string;
      bookHash: string;
      progress: EmbeddingProgress;
    }
  | {
      type: 'complete';
      runId: string;
      scope: IndexingScope;
      key: string;
      bookHash: string;
      result: IndexResult;
    }
  | {
      type: 'cancelled';
      runId: string;
      scope: IndexingScope;
      key: string;
      bookHash: string;
    }
  | {
      type: 'error';
      runId: string;
      scope: IndexingScope;
      key: string;
      bookHash: string;
      error: unknown;
    };

export type IndexingRuntimeSubscriber = (event: IndexingRuntimeEvent) => void;

const activeRunIds = new Map<string, string>();
const subscribers = new Set<IndexingRuntimeSubscriber>();
let runCounter = 0;

function toRunKey(scope: IndexingScope, key: string): string {
  return `${scope}:${key}`;
}

function nextRunId(): string {
  runCounter += 1;
  return `${Date.now()}-${runCounter}`;
}

function notify(event: IndexingRuntimeEvent): void {
  for (const subscriber of subscribers) {
    subscriber(event);
  }
}

function clearRun(scope: IndexingScope, key: string, runId: string): void {
  const runKey = toRunKey(scope, key);
  if (activeRunIds.get(runKey) === runId) {
    activeRunIds.delete(runKey);
  }
}

export function getRunId(scope: IndexingScope, key: string): string | null {
  return activeRunIds.get(toRunKey(scope, key)) ?? null;
}

export function subscribeIndexingRuntime(subscriber: IndexingRuntimeSubscriber): () => void {
  subscribers.add(subscriber);
  return () => {
    subscribers.delete(subscriber);
  };
}

export function subscribeToIndexingRun(
  scope: IndexingScope,
  key: string,
  subscriber: IndexingRuntimeSubscriber,
): () => void {
  return subscribeIndexingRuntime((event) => {
    if (event.scope === scope && event.key === key) {
      subscriber(event);
    }
  });
}

export function startBookIndexing({
  scope,
  key,
  bookHash,
  bookDoc,
  aiSettings,
  signal,
}: StartBookIndexingOptions): { runId: string; promise: Promise<IndexResult> } {
  const runKey = toRunKey(scope, key);
  const runId = nextRunId();
  activeRunIds.set(runKey, runId);
  notify({ type: 'start', runId, scope, key, bookHash });

  let cancelledBySignal = false;
  const handleAbort = () => {
    cancelBookIndexing(bookHash);
    if (activeRunIds.get(runKey) !== runId) return;
    cancelledBySignal = true;
    clearRun(scope, key, runId);
    notify({ type: 'cancelled', runId, scope, key, bookHash });
  };

  signal?.addEventListener('abort', handleAbort, { once: true });

  const promise = (async () => {
    try {
      const result = await indexBook(bookDoc, bookHash, aiSettings, (progress) => {
        if (activeRunIds.get(runKey) !== runId) return;
        notify({ type: 'progress', runId, scope, key, bookHash, progress });
      });

      if (activeRunIds.get(runKey) === runId) {
        clearRun(scope, key, runId);
        notify({ type: 'complete', runId, scope, key, bookHash, result });
      }

      return result;
    } catch (error) {
      if (!cancelledBySignal && activeRunIds.get(runKey) === runId) {
        clearRun(scope, key, runId);
        notify({ type: 'error', runId, scope, key, bookHash, error });
      }
      throw error;
    } finally {
      signal?.removeEventListener('abort', handleAbort);
    }
  })();

  return {
    runId,
    promise,
  };
}
