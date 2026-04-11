import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest';
import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';

import VocabularyPanel from '@/app/reader/components/notebook/VocabularyPanel';
import { eventDispatcher } from '@/utils/event';
import type { VocabularyEntry } from '@/services/contextTranslation/types';

const mockGetVocabularyForBook = vi.fn();
const mockGetDueVocabularyForBook = vi.fn();
const mockSearchVocabulary = vi.fn();
const mockDeleteVocabularyEntry = vi.fn();
const mockExportAsAnkiTSV = vi.fn();
const mockExportAsCSV = vi.fn();
const mockMarkVocabularyEntryReviewed = vi.fn();
const mockGetLookupHistoryForBook = vi.fn();
const mockSaveFile = vi.fn();

vi.mock('@/services/contextTranslation/lookupHistoryService', () => ({
  getLookupHistoryForBook: (...args: unknown[]) => mockGetLookupHistoryForBook(...args),
}));

const recentHistoryEntries = [
  {
    id: 'hist-new',
    recordedAt: 2_000,
    bookHash: 'book-hash',
    term: 'lookup-beta',
    context: 'context beta',
    result: { explanation: 'beta summary', translation: 'beta translation' },
    mode: 'dictionary' as const,
  },
  {
    id: 'hist-old',
    recordedAt: 1_000,
    bookHash: 'book-hash',
    term: 'lookup-alpha',
    context: 'context alpha',
    result: { contextualMeaning: 'alpha meaning', translation: 'alpha translation' },
    mode: 'translation' as const,
  },
];

vi.mock('@/hooks/useTranslation', () => ({
  useTranslation: () => (value: string) => value,
}));

vi.mock('@/context/EnvContext', () => ({
  useEnv: () => ({ appService: { saveFile: mockSaveFile } }),
}));

vi.mock('@/store/settingsStore', () => ({
  useSettingsStore: () => ({
    settings: {
      globalReadSettings: {
        contextTranslation: {
          outputFields: [
            { id: 'translation', label: 'Translation', enabled: true, order: 0 },
            { id: 'contextualMeaning', label: 'Contextual Meaning', enabled: true, order: 1 },
          ],
        },
      },
    },
  }),
}));

vi.mock('@/services/contextTranslation/vocabularyService', () => ({
  getVocabularyForBook: (...args: unknown[]) => mockGetVocabularyForBook(...args),
  getDueVocabularyForBook: (...args: unknown[]) => mockGetDueVocabularyForBook(...args),
  deleteVocabularyEntry: (...args: unknown[]) => mockDeleteVocabularyEntry(...args),
  searchVocabulary: (...args: unknown[]) => mockSearchVocabulary(...args),
  exportAsAnkiTSV: (...args: unknown[]) => mockExportAsAnkiTSV(...args),
  exportAsCSV: (...args: unknown[]) => mockExportAsCSV(...args),
  markVocabularyEntryReviewed: (...args: unknown[]) => mockMarkVocabularyEntryReviewed(...args),
}));

const entries: VocabularyEntry[] = [
  {
    id: 'alpha-id',
    bookHash: 'book-hash',
    term: 'alpha',
    context: 'alpha context',
    result: { translation: 'alpha answer', contextualMeaning: 'alpha meaning' },
    addedAt: 1000,
    reviewCount: 0,
  },
  {
    id: 'beta-id',
    bookHash: 'book-hash',
    term: 'beta',
    context: 'beta context',
    result: { translation: 'beta answer', contextualMeaning: 'beta meaning' },
    addedAt: 2000,
    reviewCount: 0,
  },
  {
    id: 'gamma-id',
    bookHash: 'book-hash',
    term: 'gamma',
    context: 'gamma context',
    result: { translation: 'gamma answer', contextualMeaning: 'gamma meaning' },
    addedAt: 500,
    reviewCount: 1,
  },
];

const singleEntry: VocabularyEntry = {
  id: 'solo-id',
  bookHash: 'book-hash',
  term: 'solo',
  context: 'solo context',
  result: { translation: 'solo answer', contextualMeaning: 'solo meaning' },
  addedAt: 3000,
  reviewCount: 0,
};

beforeEach(() => {
  vi.clearAllMocks();
  mockGetVocabularyForBook.mockResolvedValue(entries);
  mockGetDueVocabularyForBook.mockResolvedValue(entries);
  mockSearchVocabulary.mockResolvedValue([]);
  mockDeleteVocabularyEntry.mockResolvedValue(undefined);
  mockExportAsAnkiTSV.mockReturnValue('anki');
  mockExportAsCSV.mockReturnValue('csv');
  mockMarkVocabularyEntryReviewed.mockImplementation(async (entry: VocabularyEntry) => ({
    ...entry,
    reviewCount: entry.reviewCount + 1,
  }));
  mockGetLookupHistoryForBook.mockReturnValue(recentHistoryEntries);
});

afterEach(() => {
  cleanup();
});

describe('VocabularyPanel review workflow', () => {
  test('starts review from the least-reviewed oldest entry, reveals the answer, and advances on Good', async () => {
    render(<VocabularyPanel bookKey='book-key' bookHash='book-hash' />);

    await screen.findByRole('button', { name: 'Review (3)' });

    expect(screen.getByPlaceholderText('Search vocabulary...')).toBeTruthy();
    expect(screen.getByTitle('Export as Anki TSV')).toBeTruthy();

    fireEvent.click(screen.getByRole('button', { name: 'Review (3)' }));

    await screen.findByRole('button', { name: 'Exit review' });

    const searchInput = screen.getByPlaceholderText('Search vocabulary...') as HTMLInputElement;
    expect(searchInput.disabled).toBe(true);
    expect(screen.getByText('alpha')).toBeTruthy();
    expect(screen.queryByText('alpha answer')).toBeNull();

    fireEvent.click(screen.getByRole('button', { name: 'Reveal answer' }));

    expect(screen.getByText('alpha answer')).toBeTruthy();
    expect(screen.getByText('alpha meaning')).toBeTruthy();

    fireEvent.click(screen.getByRole('button', { name: 'Good' }));

    await waitFor(() => {
      expect(mockMarkVocabularyEntryReviewed).toHaveBeenCalledWith(entries[0], 4);
    });

    await screen.findByText('beta');
    expect(screen.queryByText('alpha')).toBeNull();
    expect(screen.getByRole('button', { name: 'Reveal answer' })).toBeTruthy();
  });

  test('clicking Again also advances the review session', async () => {
    render(<VocabularyPanel bookKey='book-key' bookHash='book-hash' />);

    await screen.findByRole('button', { name: 'Review (3)' });
    fireEvent.click(screen.getByRole('button', { name: 'Review (3)' }));
    await screen.findByRole('button', { name: 'Exit review' });

    fireEvent.click(screen.getByRole('button', { name: 'Reveal answer' }));
    fireEvent.click(screen.getByRole('button', { name: 'Again' }));

    await waitFor(() => {
      expect(mockMarkVocabularyEntryReviewed).toHaveBeenCalledWith(entries[0], 1);
    });

    await screen.findByText('beta');
    expect(screen.queryByText('alpha')).toBeNull();
    expect(screen.getByRole('button', { name: 'Reveal answer' })).toBeTruthy();
  });

  test('keeps review available when a search filter has no matches but the book still has saved vocabulary', async () => {
    render(<VocabularyPanel bookKey='book-key' bookHash='book-hash' />);

    const searchInput = (await screen.findByPlaceholderText(
      'Search vocabulary...',
    )) as HTMLInputElement;

    fireEvent.change(searchInput, { target: { value: 'missing' } });

    await waitFor(() => {
      expect(mockSearchVocabulary).toHaveBeenCalledWith('missing');
    });

    expect(screen.getByText('No entries match your search')).toBeTruthy();

    const reviewButton = screen.getByRole('button', { name: 'Review (3)' });
    expect(reviewButton).toBeTruthy();
    expect(reviewButton.hasAttribute('disabled')).toBe(false);

    fireEvent.click(reviewButton);

    await screen.findByRole('button', { name: 'Exit review' });
    expect(screen.getByText('alpha')).toBeTruthy();
  });

  test('disables the review button when no entries are due', async () => {
    mockGetDueVocabularyForBook.mockResolvedValueOnce([]);

    render(<VocabularyPanel bookKey='book-key' bookHash='book-hash' />);

    const reviewButton = await screen.findByRole('button', { name: 'Review vocabulary' });
    expect(reviewButton.hasAttribute('disabled')).toBe(true);
  });

  test('disables exiting review while a review save is pending', async () => {
    let resolveReview: ((entry: VocabularyEntry) => void) | undefined;
    mockMarkVocabularyEntryReviewed.mockImplementationOnce(
      () =>
        new Promise<VocabularyEntry>((resolve) => {
          resolveReview = resolve;
        }),
    );

    render(<VocabularyPanel bookKey='book-key' bookHash='book-hash' />);

    await screen.findByRole('button', { name: 'Review (3)' });

    fireEvent.click(screen.getByRole('button', { name: 'Review (3)' }));
    await screen.findByRole('button', { name: 'Exit review' });
    fireEvent.click(screen.getByRole('button', { name: 'Reveal answer' }));
    fireEvent.click(screen.getByRole('button', { name: 'Good' }));

    const exitButton = screen.getByRole('button', { name: 'Exit review' });
    expect(exitButton.hasAttribute('disabled')).toBe(true);

    if (!resolveReview) throw new Error('Expected review save promise to be pending');
    const firstEntry = entries[0]!;
    resolveReview({ ...firstEntry, reviewCount: firstEntry.reviewCount + 1 });
    await waitFor(() => {
      expect(mockMarkVocabularyEntryReviewed).toHaveBeenCalledWith(firstEntry, 4);
    });
  });

  test('ends a single-entry review session cleanly after marking Good', async () => {
    mockGetVocabularyForBook.mockResolvedValue([singleEntry]);
    mockGetDueVocabularyForBook.mockResolvedValue([singleEntry]);

    render(<VocabularyPanel bookKey='book-key' bookHash='book-hash' />);

    await screen.findByRole('button', { name: 'Review (1)' });

    fireEvent.click(screen.getByRole('button', { name: 'Review (1)' }));
    await screen.findByRole('button', { name: 'Exit review' });
    fireEvent.click(screen.getByRole('button', { name: 'Reveal answer' }));
    fireEvent.click(screen.getByRole('button', { name: 'Good' }));

    await waitFor(() => {
      expect(mockMarkVocabularyEntryReviewed).toHaveBeenCalledWith(singleEntry, 4);
    });

    await screen.findByText('solo');
    expect(screen.getByPlaceholderText('Search vocabulary...')).toBeTruthy();
    expect(screen.queryByRole('button', { name: 'Reveal answer' })).toBeNull();
  });
});

describe('VocabularyPanel lookup history surface', () => {
  test('renders recent lookups newest first with concise previews', async () => {
    render(<VocabularyPanel bookKey='book-key' bookHash='book-hash' />);

    await screen.findByText('Recent lookups');

    expect(screen.getByText('lookup-beta')).toBeTruthy();
    expect(screen.getByText('lookup-alpha')).toBeTruthy();
    expect(screen.getByText('context beta · beta summary')).toBeTruthy();
    expect(screen.getByText('context alpha · alpha meaning')).toBeTruthy();

    expect(screen.getAllByText(/lookup-(beta|alpha)/).map((node) => node.textContent)).toEqual([
      'lookup-beta',
      'lookup-alpha',
    ]);
  });

  test('renders nothing when there is no lookup history', async () => {
    mockGetLookupHistoryForBook.mockReturnValueOnce([]);

    render(<VocabularyPanel bookKey='book-key' bookHash='book-hash' />);

    await waitFor(() => {
      expect(screen.queryByText('Recent lookups')).toBeNull();
    });
  });

  test('refreshes recent lookups after a history update event for the current book', async () => {
    render(<VocabularyPanel bookKey='book-key' bookHash='book-hash' />);

    await screen.findByText('Recent lookups');
    expect(screen.getByText('lookup-beta')).toBeTruthy();

    mockGetLookupHistoryForBook.mockReturnValueOnce([
      {
        id: 'hist-fresh',
        recordedAt: 3_000,
        bookHash: 'book-hash',
        term: 'lookup-fresh',
        context: 'context fresh',
        result: { translation: 'fresh translation' },
        mode: 'translation' as const,
      },
      ...recentHistoryEntries,
    ]);

    await act(async () => {
      await eventDispatcher.dispatch('lookup-history-updated', { bookHash: 'book-hash' });
    });

    await screen.findByText('lookup-fresh');
    expect(screen.getByText('context fresh · fresh translation')).toBeTruthy();
  });

  test('hides recent lookups while the search field is focused', async () => {
    render(<VocabularyPanel bookKey='book-key' bookHash='book-hash' />);

    const searchInput = (await screen.findByPlaceholderText(
      'Search vocabulary...',
    )) as HTMLInputElement;
    expect(screen.getByText('Recent lookups')).toBeTruthy();

    fireEvent.focus(searchInput);

    expect(screen.queryByText('Recent lookups')).toBeNull();
  });

  test('hides recent lookups while filtering with a search query', async () => {
    mockSearchVocabulary.mockResolvedValueOnce([entries[1]!]);

    render(<VocabularyPanel bookKey='book-key' bookHash='book-hash' />);

    await screen.findByText('Recent lookups');

    fireEvent.change(screen.getByPlaceholderText('Search vocabulary...'), {
      target: { value: 'beta' },
    });

    await waitFor(() => {
      expect(mockSearchVocabulary).toHaveBeenCalledWith('beta');
    });

    expect(screen.queryByText('Recent lookups')).toBeNull();
    expect(screen.getByText('beta')).toBeTruthy();
  });

  test('hides recent lookups during review mode', async () => {
    render(<VocabularyPanel bookKey='book-key' bookHash='book-hash' />);

    await screen.findByText('Recent lookups');

    fireEvent.click(screen.getByRole('button', { name: 'Review (3)' }));

    await screen.findByRole('button', { name: 'Exit review' });
    expect(screen.queryByText('Recent lookups')).toBeNull();
  });
});
