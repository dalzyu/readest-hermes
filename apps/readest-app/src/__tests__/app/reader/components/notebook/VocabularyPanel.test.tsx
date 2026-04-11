import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';

import VocabularyPanel from '@/app/reader/components/notebook/VocabularyPanel';
import type { VocabularyEntry } from '@/services/contextTranslation/types';

const mockGetVocabularyForBook = vi.fn();
const mockSearchVocabulary = vi.fn();
const mockDeleteVocabularyEntry = vi.fn();
const mockExportAsAnkiTSV = vi.fn();
const mockExportAsCSV = vi.fn();
const mockMarkVocabularyEntryReviewed = vi.fn();
const mockSaveFile = vi.fn();

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
  mockSearchVocabulary.mockResolvedValue([]);
  mockDeleteVocabularyEntry.mockResolvedValue(undefined);
  mockExportAsAnkiTSV.mockReturnValue('anki');
  mockExportAsCSV.mockReturnValue('csv');
  mockMarkVocabularyEntryReviewed.mockImplementation(async (entry: VocabularyEntry) => ({
    ...entry,
    reviewCount: entry.reviewCount + 1,
  }));
});

afterEach(() => {
  cleanup();
});

describe('VocabularyPanel review workflow', () => {
  test('starts review from the least-reviewed oldest entry, reveals the answer, and advances without reshuffling the session', async () => {
    render(<VocabularyPanel bookKey='book-key' bookHash='book-hash' />);

    await waitFor(() => {
      expect(screen.getByRole('button', { name: 'Review vocabulary' })).toBeTruthy();
    });

    expect(screen.getByPlaceholderText('Search vocabulary...')).toBeTruthy();
    expect(screen.getByTitle('Export as Anki TSV')).toBeTruthy();

    fireEvent.click(screen.getByRole('button', { name: 'Review vocabulary' }));

    await screen.findByRole('button', { name: 'Exit review' });

    const searchInput = screen.getByPlaceholderText('Search vocabulary...') as HTMLInputElement;
    expect(searchInput.disabled).toBe(true);
    expect(screen.getByText('alpha')).toBeTruthy();
    expect(screen.queryByText('alpha answer')).toBeNull();

    fireEvent.click(screen.getByRole('button', { name: 'Reveal answer' }));

    expect(screen.getByText('alpha answer')).toBeTruthy();
    expect(screen.getByText('alpha meaning')).toBeTruthy();

    fireEvent.click(screen.getByRole('button', { name: 'Mark reviewed' }));

    await waitFor(() => {
      expect(mockMarkVocabularyEntryReviewed).toHaveBeenCalledWith(entries[0]);
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

    const reviewButton = screen.getByRole('button', { name: 'Review vocabulary' });
    expect(reviewButton).toBeTruthy();
    expect(reviewButton.hasAttribute('disabled')).toBe(false);

    fireEvent.click(reviewButton);

    await screen.findByRole('button', { name: 'Exit review' });
    expect(screen.getByText('alpha')).toBeTruthy();
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

    await waitFor(() => {
      expect(screen.getByRole('button', { name: 'Review vocabulary' })).toBeTruthy();
    });

    fireEvent.click(screen.getByRole('button', { name: 'Review vocabulary' }));
    await screen.findByRole('button', { name: 'Exit review' });
    fireEvent.click(screen.getByRole('button', { name: 'Reveal answer' }));
    fireEvent.click(screen.getByRole('button', { name: 'Mark reviewed' }));

    const exitButton = screen.getByRole('button', { name: 'Exit review' });
    expect(exitButton.hasAttribute('disabled')).toBe(true);

    if (!resolveReview) throw new Error('Expected review save promise to be pending');
    const firstEntry = entries[0]!;
    resolveReview({ ...firstEntry, reviewCount: firstEntry.reviewCount + 1 });
    await waitFor(() => {
      expect(mockMarkVocabularyEntryReviewed).toHaveBeenCalledWith(firstEntry);
    });
  });

  test('ends a single-entry review session cleanly after marking reviewed', async () => {
    mockGetVocabularyForBook.mockResolvedValue([singleEntry]);

    render(<VocabularyPanel bookKey='book-key' bookHash='book-hash' />);

    await waitFor(() => {
      expect(screen.getByRole('button', { name: 'Review vocabulary' })).toBeTruthy();
    });

    fireEvent.click(screen.getByRole('button', { name: 'Review vocabulary' }));
    await screen.findByRole('button', { name: 'Exit review' });
    fireEvent.click(screen.getByRole('button', { name: 'Reveal answer' }));
    fireEvent.click(screen.getByRole('button', { name: 'Mark reviewed' }));

    await waitFor(() => {
      expect(mockMarkVocabularyEntryReviewed).toHaveBeenCalledWith(singleEntry);
    });

    await screen.findByText('solo');
    expect(screen.getByPlaceholderText('Search vocabulary...')).toBeTruthy();
    expect(screen.queryByRole('button', { name: 'Reveal answer' })).toBeNull();
  });
});
