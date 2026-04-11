import type { Book } from '@/types/book';
import type { BookSeries } from '@/services/contextTranslation/types';

/**
 * Normalize text for series-matching comparison.
 * Strips non-ASCII characters (CJK, Arabic, Cyrillic, etc.) so only
 * lowercase a-z and 0-9 remain.
 */
export function normalizeSuggestionText(value: string | undefined): string {
  return (value || '').toLowerCase().replace(/[^a-z0-9]+/gi, ' ').trim();
}

/**
 * Extract a trailing volume number from a title string.
 * e.g. "Grey Castle 4" -> 4, "Volume 2" -> 2, "Book 10" -> 10
 */
export function extractVolumeNumber(title: string | undefined): number | undefined {
  if (!title) return undefined;
  const match =
    title.match(/(?:vol(?:ume)?|book)?\s*(\d+)\s*$/i) ||
    title.match(/\b(\d+)\b(?!.*\b\d+\b)/);
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
    const normTitle = normalizeSuggestionText(book.title);
    const normAuthor = normalizeSuggestionText(book.author);

    const candidates = existingSeries
      .filter((series) => !series.volumes.some((v) => v.bookHash === book.hash))
      .map((series) => {
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
            const existingTitle = normalizeSuggestionText(sb.title);
            if (!existingTitle) return false;
            const overlap = existingTitle
              .split(' ')
              .filter((tok) => tok && normTitle.includes(tok));
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
      .flat()
      .sort((a, b) => (b.suggestedVolumeIndex || 0) - (a.suggestedVolumeIndex || 0));

    return candidates.slice(0, 1);
  });
}
