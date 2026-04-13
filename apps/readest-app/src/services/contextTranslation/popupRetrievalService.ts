import { boundedHybridSearch, hybridSearch } from '@/services/ai/ragService';
import { aiStore } from '@/services/ai/storage/aiStore';
import type { AISettings, ScoredChunk } from '@/services/ai/types';

import { getPopupLocalContext } from './pageContextService';
import { getPriorVolumes, getSeriesForBook } from './seriesService';
import type { ContextTranslationSettings, PopupContextBundle } from './types';

// ---------------------------------------------------------------------------
// Page-level RAG chunk cache — subsequent lookups on the same page reuse results
// ---------------------------------------------------------------------------
interface PageCacheEntry {
  sameBookChunks: string[];
  priorVolumeChunks: string[];
  missingPriorVolumes: number[];
}

const pageCache = new Map<string, PageCacheEntry>();
let pageCacheBookHash = '';

function getPageCacheKey(bookHash: string, page: number): string {
  return `${bookHash}:${page}`;
}

/** Invalidate page cache on book change or navigation. */
export function invalidatePageCache(bookHash?: string): void {
  if (!bookHash || bookHash !== pageCacheBookHash) {
    pageCache.clear();
    pageCacheBookHash = bookHash ?? '';
  }
}

interface BuildPopupContextBundleOptions {
  bookKey: string;
  bookHash: string;
  currentPage: number;
  selectedText: string;
  settings: ContextTranslationSettings;
  aiSettings: AISettings;
}

function formatChunk(chunk: ScoredChunk, prefix?: string): string {
  const header = prefix ? `${prefix} · ${chunk.chapterTitle}` : chunk.chapterTitle;
  return `[${header}] ${chunk.text}`;
}

function buildRetrievalQuery(
  selectedText: string,
  localPastContext: string,
  localFutureBuffer: string,
): string {
  const tailContext = localPastContext.slice(-240);
  const headFuture = localFutureBuffer.slice(0, 120);
  return [selectedText, tailContext, headFuture].filter(Boolean).join('\n');
}

export async function buildPopupContextBundle({
  bookKey,
  bookHash,
  currentPage,
  selectedText,
  settings,
  aiSettings,
}: BuildPopupContextBundleOptions): Promise<PopupContextBundle> {
  const localContext = await getPopupLocalContext(
    bookKey,
    bookHash,
    currentPage,
    settings.recentContextPages,
    selectedText,
    settings.lookAheadWords,
  );

  const series = await getSeriesForBook(bookHash);
  const priorVolumes = settings.priorVolumeRagEnabled ? await getPriorVolumes(bookHash) : [];
  const currentVolumeIndexed =
    (settings.sameBookRagEnabled || settings.priorVolumeRagEnabled) &&
    (await aiStore.isIndexed(bookHash));

  if (!currentVolumeIndexed) {
    const missingPriorVolumes: number[] = [];
    for (const volume of priorVolumes) {
      const indexed = await aiStore.isIndexed(volume.bookHash);
      if (!indexed) {
        missingPriorVolumes.push(volume.volumeIndex);
      }
    }

    return {
      localPastContext: localContext.localPastContext,
      localFutureBuffer: localContext.localFutureBuffer,
      sameBookChunks: [],
      priorVolumeChunks: [],
      retrievalStatus: 'local-only',
      retrievalHints: {
        currentVolumeIndexed: false,
        missingLocalIndex: true,
        missingPriorVolumes,
        missingSeriesAssignment: !series,
      },
      dictionaryEntries: [],
    };
  }

  const query = buildRetrievalQuery(
    selectedText,
    localContext.localPastContext,
    localContext.localFutureBuffer,
  );

  // Check page-level cache
  const pageCacheKey = getPageCacheKey(bookHash, currentPage);
  if (bookHash !== pageCacheBookHash) {
    invalidatePageCache(bookHash);
  }
  const cached = pageCache.get(pageCacheKey);

  let sameBookChunks: string[];
  let priorVolumeChunks: string[];
  let missingPriorVolumes: number[];

  if (cached) {
    sameBookChunks = cached.sameBookChunks;
    priorVolumeChunks = cached.priorVolumeChunks;
    missingPriorVolumes = cached.missingPriorVolumes;
  } else {
    const sameBookPromise =
      settings.sameBookRagEnabled && localContext.windowStartPage > 1
        ? boundedHybridSearch(bookHash, query, aiSettings, settings.sameBookChunkCount, {
            maxPage: localContext.windowStartPage - 1,
          }).then((chunks) => chunks.map((chunk) => formatChunk(chunk)))
        : Promise.resolve([] as string[]);

    missingPriorVolumes = [];
    // Launch all prior-volume searches concurrently
    const priorVolumePromises: Promise<Array<{ text: string; score: number }>>[] = [];
    if (settings.priorVolumeRagEnabled) {
      for (const volume of priorVolumes) {
        priorVolumePromises.push(
          aiStore.isIndexed(volume.bookHash).then(async (indexed) => {
            if (!indexed) {
              missingPriorVolumes.push(volume.volumeIndex);
              return [];
            }
            const results = await hybridSearch(
              volume.bookHash,
              query,
              aiSettings,
              settings.priorVolumeChunkCount,
            );
            return results.map((chunk) => ({
              text: formatChunk(chunk, volume.label ?? `Vol. ${volume.volumeIndex}`),
              score: chunk.score,
            }));
          }),
        );
      }
    }

    // Await same-book and all prior-volume searches in parallel
    const [sameBookResult, ...priorVolumeResultArrays] = await Promise.all([
      sameBookPromise,
      ...priorVolumePromises,
    ]);

    sameBookChunks = sameBookResult;
    priorVolumeChunks = priorVolumeResultArrays
      .flat()
      .sort((a, b) => b.score - a.score)
      .slice(0, settings.priorVolumeChunkCount)
      .map((chunk) => chunk.text);

    // Store in page cache
    pageCache.set(pageCacheKey, { sameBookChunks, priorVolumeChunks, missingPriorVolumes });
  }

  return {
    localPastContext: localContext.localPastContext,
    localFutureBuffer: localContext.localFutureBuffer,
    sameBookChunks,
    priorVolumeChunks,
    retrievalStatus: priorVolumeChunks.length > 0 ? 'cross-volume' : 'local-volume',
    retrievalHints: {
      currentVolumeIndexed: true,
      missingLocalIndex: false,
      missingPriorVolumes,
      missingSeriesAssignment: !series,
    },
    dictionaryEntries: [],
  };
}
