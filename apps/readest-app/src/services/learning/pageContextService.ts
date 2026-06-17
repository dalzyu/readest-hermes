import { aiStore } from '@/services/ai/storage/aiStore';
import { useBookDataStore } from '@/store/bookDataStore';
import { useReaderStore } from '@/store/readerStore';

import {
  assemblePopupLocalContext,
  assembleRecentContext,
  type PageContent,
  type PopupLocalContext,
} from './contextAssembler';

function groupChunksByPage(
  bookHash: string,
  chunks: Awaited<ReturnType<typeof aiStore.getChunks>>,
): PageContent[] {
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

/**
 * Fallback: get text from the bookDoc section corresponding to the current page.
 * Uses the view's CFI resolution to find the current section.
 */
async function getSectionTextFromBookDoc(bookKey: string): Promise<string> {
  try {
    const bookData = useBookDataStore.getState().getBookData(bookKey);
    const bookDoc = bookData?.bookDoc;
    if (!bookDoc?.sections?.length) return '';

    const view = useReaderStore.getState().getView(bookKey);
    if (!view) return '';

    // Try to get current section index via the view's CFI progress
    const cfiProgress = await view.getCFIProgress('');
    const sectionIndex = cfiProgress?.section.current ?? 0;
    const section = bookDoc.sections[sectionIndex];
    if (!section) return '';

    const doc = await section.createDocument();
    const body = doc.body?.textContent ?? doc.documentElement?.textContent ?? '';
    return body.trim();
  } catch {
    return '';
  }
}

export async function getPopupLocalContext(
  bookKey: string,
  bookHash: string,
  currentPage: number,
  windowSize: number,
  selectedText: string,
  lookAheadWords: number,
): Promise<PopupLocalContext> {
  const chunks = await aiStore.getChunks(bookHash);
  if (chunks.length === 0) {
    // Fallback: try to get section text directly from bookDoc when not indexed
    const sectionText = await getSectionTextFromBookDoc(bookKey);
    if (sectionText) {
      const selectionIndex = sectionText.indexOf(selectedText);
      if (selectionIndex !== -1) {
        const pastText = sectionText.slice(0, selectionIndex + selectedText.length).trim();
        const futureText = sectionText.slice(selectionIndex + selectedText.length).trim();
        return {
          localPastContext: pastText,
          localFutureBuffer: futureText.slice(0, lookAheadWords * 5), // rough word-based trim
          windowStartPage: currentPage,
        };
      }
    }
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
