export interface PageContent {
  pageNumber: number;
  text: string;
}

export interface PopupLocalContextOptions {
  currentPage: number;
  windowSize: number;
  selectedText: string;
  lookAheadWords: number;
}

export interface PopupLocalContext {
  localPastContext: string;
  localFutureBuffer: string;
  windowStartPage: number;
}

// Simplified: Han chars are individual tokens, words are alphanumeric sequences
// (apostrophes/hyphens allowed mid-word). Punctuation/symbols are ignored and
// not counted as tokens, preventing incomplete tokens when slicing.
const TOKEN_REGEX = /[\p{Script=Han}]|[\p{L}\p{N}]+(?:['\u2019'-][\p{L}\p{N}]+)*/gu;

function trimToTokenCount(text: string, tokenCount: number): string {
  if (tokenCount <= 0) return '';
  const matches = Array.from(text.matchAll(TOKEN_REGEX));
  if (matches.length <= tokenCount) {
    return text.trim();
  }

  const lastMatch = matches[tokenCount - 1];
  if (!lastMatch?.index) {
    return text.trim();
  }

  return text
    .slice(0, lastMatch.index + lastMatch[0].length)
    .trim();
}

function splitCurrentPageText(currentPageText: string, selectedText: string) {
  const selectionIndex = selectedText ? currentPageText.indexOf(selectedText) : -1;
  if (selectionIndex === -1) {
    return {
      pastText: currentPageText.trim(),
      futureText: '',
    };
  }

  const selectionEnd = selectionIndex + selectedText.length;
  return {
    pastText: currentPageText.slice(0, selectionEnd).trim(),
    futureText: currentPageText.slice(selectionEnd).trim(),
  };
}

export function assemblePopupLocalContext(
  pages: PageContent[],
  options: PopupLocalContextOptions,
): PopupLocalContext {
  if (pages.length === 0) {
    return {
      localPastContext: '',
      localFutureBuffer: '',
      windowStartPage: options.currentPage,
    };
  }

  const eligiblePages = [...pages]
    .filter((page) => page.pageNumber <= options.currentPage)
    .sort((a, b) => a.pageNumber - b.pageNumber);
  const effectivePages = eligiblePages.length > 0 ? eligiblePages : [...pages].sort((a, b) => a.pageNumber - b.pageNumber);
  const windowPages = effectivePages.slice(-options.windowSize);
  const currentPageContent = windowPages[windowPages.length - 1];

  if (!currentPageContent) {
    return {
      localPastContext: '',
      localFutureBuffer: '',
      windowStartPage: options.currentPage,
    };
  }

  const { pastText, futureText } = splitCurrentPageText(currentPageContent.text, options.selectedText);
  const earlierPages = windowPages
    .filter((page) => page.pageNumber < currentPageContent.pageNumber)
    .map((page) => page.text.trim())
    .filter(Boolean);

  const futurePages = [...pages]
    .filter((page) => page.pageNumber > currentPageContent.pageNumber)
    .sort((a, b) => a.pageNumber - b.pageNumber)
    .map((page) => page.text.trim())
    .filter(Boolean);

  const localPastContext = [...earlierPages, pastText].filter(Boolean).join('\n');
  const futureSource = [futureText, ...futurePages].filter(Boolean).join('\n');

  return {
    localPastContext,
    localFutureBuffer: trimToTokenCount(futureSource, options.lookAheadWords),
    windowStartPage: windowPages[0]?.pageNumber ?? currentPageContent.pageNumber,
  };
}

export function assembleRecentContext(
  pages: PageContent[],
  windowSize: number,
  currentPage: number,
): string {
  return assemblePopupLocalContext(pages, {
    currentPage,
    windowSize,
    selectedText: '',
    lookAheadWords: 0,
  }).localPastContext;
}
