import { buildPopupContextBundle } from './popupRetrievalService';
import type { ContextTranslationSettings, PopupContextBundle } from './types';
import type { AISettings } from '@/services/ai/types';

// ---------------------------------------------------------------------------
// Selection-start prefetch — begins building the popup context bundle as soon
// as the user selects text, so that RAG results are warm by the time the
// translate/dictionary popup opens.
// ---------------------------------------------------------------------------

interface PrefetchEntry {
  key: string;
  promise: Promise<PopupContextBundle>;
}

let currentPrefetch: PrefetchEntry | null = null;

function makeCacheKey(bookHash: string, page: number, selectedText: string): string {
  return `${bookHash}:${page}:${selectedText}`;
}

/** Fire-and-forget: start building the context bundle for the current selection. */
export function startPrefetch(opts: {
  bookKey: string;
  bookHash: string;
  currentPage: number;
  selectedText: string;
  settings: ContextTranslationSettings;
  aiSettings: AISettings;
}): void {
  const key = makeCacheKey(opts.bookHash, opts.currentPage, opts.selectedText);

  // Already prefetching for this exact key
  if (currentPrefetch?.key === key) return;

  // Discard stale prefetch
  currentPrefetch = null;

  const promise = buildPopupContextBundle({
    bookKey: opts.bookKey,
    bookHash: opts.bookHash,
    currentPage: opts.currentPage,
    selectedText: opts.selectedText,
    settings: opts.settings,
    aiSettings: opts.aiSettings,
  });

  currentPrefetch = { key, promise };
}

/**
 * If a prefetched bundle matches the given parameters, return it (consuming
 * the cache slot). Returns null on miss or if the prefetch hasn't resolved yet
 * and the caller doesn't want to wait — callers should `await` the result.
 */
export async function consumePrefetch(
  bookHash: string,
  page: number,
  selectedText: string,
): Promise<PopupContextBundle | null> {
  if (!currentPrefetch) return null;

  const key = makeCacheKey(bookHash, page, selectedText);
  if (currentPrefetch.key !== key) {
    currentPrefetch = null;
    return null;
  }

  try {
    const result = await currentPrefetch.promise;
    currentPrefetch = null;
    return result;
  } catch {
    currentPrefetch = null;
    return null;
  }
}

/** Cancel any in-flight prefetch (e.g. on scroll or navigation). */
export function cancelPrefetch(): void {
  currentPrefetch = null;
}
