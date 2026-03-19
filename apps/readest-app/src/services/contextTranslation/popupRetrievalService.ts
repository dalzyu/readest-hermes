import { boundedHybridSearch, hybridSearch } from '@/services/ai/ragService';
import { aiStore } from '@/services/ai/storage/aiStore';
import type { AISettings, ScoredChunk } from '@/services/ai/types';

import { getPopupLocalContext } from './pageContextService';
import { getPriorVolumes, getSeriesForBook } from './seriesService';
import type { ContextTranslationSettings, PopupContextBundle } from './types';

interface BuildPopupContextBundleOptions {
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

function buildRetrievalQuery(selectedText: string, localPastContext: string, localFutureBuffer: string): string {
  const tailContext = localPastContext.slice(-240);
  const headFuture = localFutureBuffer.slice(0, 120);
  return [selectedText, tailContext, headFuture].filter(Boolean).join('\n');
}

export async function buildPopupContextBundle({
  bookHash,
  currentPage,
  selectedText,
  settings,
  aiSettings,
}: BuildPopupContextBundleOptions): Promise<PopupContextBundle> {
  const localContext = await getPopupLocalContext(
    bookHash,
    currentPage,
    settings.recentContextPages,
    selectedText,
    settings.lookAheadWords,
  );

  const series = await getSeriesForBook(bookHash);
  const priorVolumes = settings.priorVolumeRagEnabled ? await getPriorVolumes(bookHash) : [];
  const currentVolumeIndexed =
    (settings.sameBookRagEnabled || settings.priorVolumeRagEnabled) && (await aiStore.isIndexed(bookHash));

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
    };
  }

  const query = buildRetrievalQuery(
    selectedText,
    localContext.localPastContext,
    localContext.localFutureBuffer,
  );

  const sameBookChunks =
    settings.sameBookRagEnabled && localContext.windowStartPage > 1
      ? (
          await boundedHybridSearch(
            bookHash,
            query,
            aiSettings,
            settings.sameBookChunkCount,
            { maxPage: localContext.windowStartPage - 1 },
          )
        ).map((chunk) => formatChunk(chunk))
      : [];

  const missingPriorVolumes: number[] = [];
  const priorVolumeResults: Array<{ text: string; score: number }> = [];
  if (settings.priorVolumeRagEnabled) {
    for (const volume of priorVolumes) {
      const indexed = await aiStore.isIndexed(volume.bookHash);
      if (!indexed) {
        missingPriorVolumes.push(volume.volumeIndex);
        continue;
      }

      const results = await hybridSearch(
        volume.bookHash,
        query,
        aiSettings,
        settings.priorVolumeChunkCount,
      );
      for (const chunk of results) {
        priorVolumeResults.push({
          text: formatChunk(chunk, volume.label ?? `Vol. ${volume.volumeIndex}`),
          score: chunk.score,
        });
      }
    }
  }

  const priorVolumeChunks = priorVolumeResults
    .sort((a, b) => b.score - a.score)
    .slice(0, settings.priorVolumeChunkCount)
    .map((chunk) => chunk.text);

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
  };
}
