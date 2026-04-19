import { vectorSearch } from '@/services/ai/ragService';
import { aiStore } from '@/services/ai/storage/aiStore';
import type { AISettings, ScoredChunk } from '@/services/ai/types';

import { getPopupLocalContext } from './pageContextService';
import { getDictionaryForm, isTokenizerReady } from './plugins/jpTokenizer';
import { getPriorVolumes, getSeriesForBook } from './seriesService';
import type { ContextTranslationSettings, PopupContextBundle } from './types';
import { getCJKLanguage } from './utils';

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

function normalizeCacheSegment(value: string): string {
  return value.replace(/\s+/gu, ' ').trim().toLocaleLowerCase();
}

function buildSelectedTextCacheSegment(selectedText: string, pageContext: string): string {
  const normalizedSelectedText = normalizeCacheSegment(selectedText);
  if (!normalizedSelectedText) return '';

  const cjkLanguage = getCJKLanguage(selectedText, pageContext);
  if (cjkLanguage !== 'japanese' || !isTokenizerReady()) {
    return normalizedSelectedText;
  }

  const normalizedBaseForm = normalizeCacheSegment(getDictionaryForm(selectedText));
  if (!normalizedBaseForm || normalizedBaseForm === normalizedSelectedText) {
    return normalizedSelectedText;
  }

  return `${normalizedSelectedText}|${normalizedBaseForm}`;
}

function getPageCacheKey(
  bookHash: string,
  page: number,
  currentSentenceHash: string,
  selectedTextCacheSegment: string,
): string {
  return `${bookHash}:${page}:${currentSentenceHash}:${selectedTextCacheSegment}`;
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

const RETRIEVAL_QUERY_TAIL_CHARS = 480;
const RETRIEVAL_QUERY_FUTURE_CHARS = 240;
const SAME_BOOK_SEARCH_MULTIPLIER = 3;
const PRIOR_VOLUME_SEARCH_MULTIPLIER = 2;

function buildRetrievalQuery(
  selectedText: string,
  localPastContext: string,
  localFutureBuffer: string,
  currentSentence: string,
): string {
  const tailContext = localPastContext.slice(-RETRIEVAL_QUERY_TAIL_CHARS);
  const headFuture = localFutureBuffer.slice(0, RETRIEVAL_QUERY_FUTURE_CHARS);
  return [selectedText, currentSentence, tailContext, headFuture].filter(Boolean).join('\n');
}

function isSentenceBoundary(char: string): boolean {
  return /[.!?。！？\n]/u.test(char);
}

function extractCurrentSentence(
  localPastContext: string,
  localFutureBuffer: string,
  selectedText: string,
): string {
  const combined = `${localPastContext}${localFutureBuffer}`.trim();
  if (!combined || !selectedText) return '';

  const selectionStart = localPastContext.lastIndexOf(selectedText);
  const fallbackStart = selectionStart === -1 ? combined.indexOf(selectedText) : selectionStart;
  if (fallbackStart === -1) return '';

  let sentenceStart = fallbackStart;
  while (sentenceStart > 0 && !isSentenceBoundary(combined[sentenceStart - 1]!)) {
    sentenceStart -= 1;
  }

  let sentenceEnd = fallbackStart + selectedText.length;
  while (sentenceEnd < combined.length && !isSentenceBoundary(combined[sentenceEnd]!)) {
    sentenceEnd += 1;
  }
  if (sentenceEnd < combined.length) {
    sentenceEnd += 1;
  }

  return combined.slice(sentenceStart, sentenceEnd).trim();
}

function hashSentence(sentence: string): string {
  const normalized = sentence.replace(/\s+/gu, ' ').trim().toLowerCase();
  let hash = 0;
  for (let i = 0; i < normalized.length; i += 1) {
    hash = (hash * 31 + normalized.charCodeAt(i)) >>> 0;
  }
  return hash.toString(16);
}

function splitChunkIntoSentences(text: string): string[] {
  return (text.match(/[^.!?。！？\n]+[.!?。！？]?/gu) ?? [text])
    .map((sentence) => sentence.trim())
    .filter(Boolean);
}

function chunkMatchesSentence(chunk: ScoredChunk, sentenceHash: string): boolean {
  if (!sentenceHash) return false;
  return splitChunkIntoSentences(chunk.text).some(
    (sentence) => hashSentence(sentence) === sentenceHash,
  );
}

function dedupeByChunkText<T extends { text: string }>(chunks: T[]): T[] {
  const seen = new Set<string>();
  const deduped: T[] = [];

  for (const chunk of chunks) {
    const key = chunk.text.replace(/\s+/gu, ' ').trim().toLowerCase();
    if (!key || seen.has(key)) continue;
    seen.add(key);
    deduped.push(chunk);
  }

  return deduped;
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

  const currentSentence = extractCurrentSentence(
    localContext.localPastContext,
    localContext.localFutureBuffer,
    selectedText,
  );
  const currentSentenceHash = currentSentence ? hashSentence(currentSentence) : '';
  const query = buildRetrievalQuery(
    selectedText,
    localContext.localPastContext,
    localContext.localFutureBuffer,
    currentSentence,
  );

  // Check page-level cache
  const selectedTextCacheSegment = buildSelectedTextCacheSegment(
    selectedText,
    `${localContext.localPastContext}\n${localContext.localFutureBuffer}`,
  );
  const pageCacheKey = getPageCacheKey(
    bookHash,
    currentPage,
    currentSentenceHash,
    selectedTextCacheSegment,
  );
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
    const sameBookSearchTopK = Math.max(
      settings.sameBookChunkCount,
      settings.sameBookChunkCount * SAME_BOOK_SEARCH_MULTIPLIER,
    );
    const priorVolumeSearchTopK = Math.max(
      settings.priorVolumeChunkCount,
      settings.priorVolumeChunkCount * PRIOR_VOLUME_SEARCH_MULTIPLIER,
    );

    const sameBookPromise =
      settings.sameBookRagEnabled && localContext.windowStartPage > 1
        ? vectorSearch(bookHash, query, aiSettings, sameBookSearchTopK, {
            maxPage: localContext.windowStartPage - 1,
          }).then((chunks) =>
            dedupeByChunkText(
              chunks.filter((chunk) => !chunkMatchesSentence(chunk, currentSentenceHash)),
            )
              .slice(0, settings.sameBookChunkCount)
              .map((chunk) => formatChunk(chunk)),
          )
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
            const results = await vectorSearch(
              volume.bookHash,
              query,
              aiSettings,
              priorVolumeSearchTopK,
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
    priorVolumeChunks = dedupeByChunkText(
      priorVolumeResultArrays.flat().sort((a, b) => b.score - a.score),
    )
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
