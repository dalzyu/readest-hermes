import type { Book } from '@/types/book';
import type { BookSeries } from '@/services/contextTranslation/types';

const WORD_TOKEN_PATTERN = /[\p{L}\p{N}\p{M}]+/gu;

const suggestionSegmenter =
  typeof Intl !== 'undefined' && typeof Intl.Segmenter === 'function'
    ? (() => {
        try {
          return new Intl.Segmenter('und', { granularity: 'word' });
        } catch {
          return null;
        }
      })()
    : null;

function tokenizeSuggestionText(value: string | undefined): string[] {
  const normalized = (value || '').normalize('NFKC').toLowerCase().trim();
  if (!normalized) return [];

  if (suggestionSegmenter) {
    const tokens = Array.from(suggestionSegmenter.segment(normalized))
      .filter((segment) => segment.isWordLike)
      .map((segment) => segment.segment)
      .filter(Boolean);

    if (tokens.length > 0) return tokens;
  }

  return normalized.match(WORD_TOKEN_PATTERN) ?? [];
}

/**
 * Normalize text for series-matching comparison.
 * Uses Unicode normalization and word-aware tokenization so non-Latin scripts
 * stay comparable while ASCII matching behavior remains intact.
 */
export function normalizeSuggestionText(value: string | undefined): string {
  return tokenizeSuggestionText(value).join(' ');
}

/**
 * Extract a trailing volume number from a title string.
 * e.g. "Grey Castle 4" -> 4, "Volume 2" -> 2, "Book 10" -> 10
 */
export function extractVolumeNumber(title: string | undefined): number | undefined {
  if (!title) return undefined;
  const match =
    title.match(/(?:vol(?:ume)?|book)?\s*(\d+)\s*$/i) || title.match(/\b(\d+)\b(?!.*\b\d+\b)/);
  if (!match?.[1]) return undefined;
  const parsed = Number.parseInt(match[1], 10);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : undefined;
}

export interface ImportSeriesSuggestion {
  book: Book;
  series: BookSeries;
  suggestedVolumeIndex?: number;
}

/**
 * Given newly imported books, existing series, and the full library,
 * find series that each imported book probably belongs to.
 *
 * Matching requires BOTH:
 * - Author match: one of the series's existing books has the same author
 * - Title match: the imported book's title shares at least 2 tokens with
 *   an existing series book, OR the series name is a prefix of the title
 *
 * Results are sorted by suggested volume index (highest first) and capped at 1.
 */
export function buildImportSeriesSuggestions(
  importedBooks: Book[],
  existingSeries: BookSeries[],
  libraryBooks: Book[],
): ImportSeriesSuggestion[] {
  return importedBooks.flatMap<ImportSeriesSuggestion>((book) => {
    const normTitleTokens = tokenizeSuggestionText(book.title);
    const normTitle = normTitleTokens.join(' ');
    const normAuthor = normalizeSuggestionText(book.author);

    const candidates = existingSeries
      .filter((series) => !series.volumes.some((v) => v.bookHash === book.hash))
      .flatMap((series) => {
        const normSeriesName = normalizeSuggestionText(series.name);
        const seriesBooks = series.volumes
          .map((v) => libraryBooks.find((lb) => lb.hash === v.bookHash))
          .filter((b): b is Book => !!b);

        const authorMatches = seriesBooks.some(
          (sb) => normalizeSuggestionText(sb.author) === normAuthor,
        );

        const titleMatches =
          (!!normSeriesName && normTitle.includes(normSeriesName)) ||
          seriesBooks.some((sb) => {
            const existingTitleTokens = tokenizeSuggestionText(sb.title);
            if (!existingTitleTokens.length) return false;
            const overlap = existingTitleTokens.filter((tok) => normTitleTokens.includes(tok));
            return overlap.length >= 2;
          });

        if (!authorMatches || !titleMatches) return [];

        return [
          {
            book,
            series,
            suggestedVolumeIndex: extractVolumeNumber(book.title),
          },
        ];
      })
      .sort((a, b) => (b.suggestedVolumeIndex || 0) - (a.suggestedVolumeIndex || 0));

    return candidates.slice(0, 1);
  });
}
