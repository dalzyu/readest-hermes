import { aiStore } from '@/services/ai/storage/aiStore';

import {
  assemblePopupLocalContext,
  assembleRecentContext,
  type PageContent,
  type PopupLocalContext,
} from './contextAssembler';

function groupChunksByPage(bookHash: string, chunks: Awaited<ReturnType<typeof aiStore.getChunks>>): PageContent[] {
  const pages = new Map<number, string[]>();

  for (const chunk of chunks) {
    if (chunk.bookHash !== bookHash) continue;
    const pageEntries = pages.get(chunk.pageNumber) ?? [];
    pageEntries.push(chunk.text);
    pages.set(chunk.pageNumber, pageEntries);
  }

  return Array.from(pages.entries())
    .sort((a, b) => a[0] - b[0])
    .map(([pageNumber, texts]) => ({
      pageNumber,
      text: texts.join('\n'),
    }));
}

export async function getPopupLocalContext(
  bookHash: string,
  currentPage: number,
  windowSize: number,
  selectedText: string,
  lookAheadWords: number,
): Promise<PopupLocalContext> {
  const chunks = await aiStore.getChunks(bookHash);
  if (chunks.length === 0) {
    return {
      localPastContext: '',
      localFutureBuffer: '',
      windowStartPage: currentPage,
    };
  }

  const pages = groupChunksByPage(bookHash, chunks);
  return assemblePopupLocalContext(pages, {
    currentPage,
    windowSize,
    selectedText,
    lookAheadWords,
  });
}

export async function getRecentPageContext(
  bookHash: string,
  currentPage: number,
  windowSize: number,
): Promise<string> {
  const chunks = await aiStore.getChunks(bookHash);
  if (chunks.length === 0) return '';

  const pages = groupChunksByPage(bookHash, chunks);
  return assembleRecentContext(pages, windowSize, currentPage);
}
