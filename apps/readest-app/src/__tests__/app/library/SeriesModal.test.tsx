import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, test, vi } from 'vitest';

import type { Book } from '@/types/book';
import SeriesModal from '@/app/library/components/SeriesModal';
import { eventDispatcher } from '@/utils/event';

const mockGetAllSeries = vi.fn();
const mockGetSeriesForBook = vi.fn();
const mockCreateSeries = vi.fn();
const mockAddBookToSeries = vi.fn();
const mockRemoveBookFromSeries = vi.fn();
const mockDeleteSeries = vi.fn();
const mockUpdateSeriesVolume = vi.fn();
const mockIsIndexed = vi.fn();
const mockIndexBook = vi.fn();
const mockLoadBookContent = vi.fn();
const mockOpen = vi.fn();

vi.mock('@/hooks/useTranslation', () => ({
  useTranslation: () => (value: string) => value,
}));

vi.mock('@/context/EnvContext', () => ({
  useEnv: () => ({
    appService: {
      loadBookContent: (...args: unknown[]) => mockLoadBookContent(...args),
    },
  }),
}));

vi.mock('@/store/libraryStore', () => ({
  useLibraryStore: () => ({
    library: [
      {
        hash: 'vol-1',
        format: 'EPUB',
        title: 'Grey Castle 1',
        author: 'Zhang San',
        createdAt: 1,
        updatedAt: 1,
      },
      {
        hash: 'vol-2',
        format: 'EPUB',
        title: 'Grey Castle 2',
        author: 'Zhang San',
        createdAt: 1,
        updatedAt: 1,
      },
    ] as Book[],
  }),
}));

vi.mock('@/store/settingsStore', () => ({
  useSettingsStore: () => ({
    settings: {
      aiSettings: {
        provider: 'openai',
      },
    },
  }),
}));

vi.mock('@/services/contextTranslation/seriesService', () => ({
  getAllSeries: () => mockGetAllSeries(),
  createSeries: (...args: unknown[]) => mockCreateSeries(...args),
  addBookToSeries: (...args: unknown[]) => mockAddBookToSeries(...args),
  removeBookFromSeries: (...args: unknown[]) => mockRemoveBookFromSeries(...args),
  deleteSeries: (...args: unknown[]) => mockDeleteSeries(...args),
  getSeriesForBook: (...args: unknown[]) => mockGetSeriesForBook(...args),
  updateSeriesVolume: (...args: unknown[]) => mockUpdateSeriesVolume(...args),
}));

vi.mock('@/services/ai/storage/aiStore', () => ({
  aiStore: {
    isIndexed: (...args: unknown[]) => mockIsIndexed(...args),
    getIndexedStateMap: async (bookHashes: string[]) => {
      const entries = await Promise.all(
        (bookHashes as string[]).map(
          async (hash) => [hash, await mockIsIndexed(hash)] as [string, boolean],
        ),
      );
      return Object.fromEntries(entries);
    },
  },
}));

vi.mock('@/services/ai', () => ({
  indexBook: (...args: unknown[]) => mockIndexBook(...args),
}));

vi.mock('@/libs/document', () => ({
  DocumentLoader: class {
    open() {
      return mockOpen();
    }
  },
}));

describe('SeriesModal', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockGetAllSeries.mockResolvedValue([
      {
        id: 'series-1',
        name: 'The Grey Castle',
        volumes: [
          { bookHash: 'vol-1', volumeIndex: 1, label: 'Vol. 1' },
          { bookHash: 'vol-2', volumeIndex: 2, label: 'Vol. 2' },
        ],
        createdAt: 1,
        updatedAt: 1,
      },
    ]);
    mockGetSeriesForBook.mockResolvedValue({
      id: 'series-1',
      name: 'The Grey Castle',
      volumes: [
        { bookHash: 'vol-1', volumeIndex: 1, label: 'Vol. 1' },
        { bookHash: 'vol-2', volumeIndex: 2, label: 'Vol. 2' },
      ],
      createdAt: 1,
      updatedAt: 1,
    });
    mockIsIndexed.mockImplementation(async (bookHash: string) => bookHash === 'vol-1');
    mockLoadBookContent.mockResolvedValue({ file: new File(['book'], 'book.epub') });
    mockOpen.mockResolvedValue({
      book: {
        metadata: { title: 'Grey Castle' },
        sections: [],
        toc: [],
      },
    });
  });

  test('shows ordered volumes, indexing state, and indexes all volumes in order', async () => {
    render(<SeriesModal />);

    await eventDispatcher.dispatch('manage-series', {
      hash: 'vol-2',
      title: 'Grey Castle 2',
    });

    await waitFor(() => {
      expect(screen.getByRole('heading', { name: 'The Grey Castle' })).toBeTruthy();
    });

    expect(screen.getByDisplayValue('Vol. 1')).toBeTruthy();
    expect(screen.getByDisplayValue('Vol. 2')).toBeTruthy();
    expect(screen.getByText('Indexed')).toBeTruthy();
    expect(screen.getByText('Not indexed')).toBeTruthy();

    fireEvent.click(screen.getByRole('button', { name: 'Index All' }));

    await waitFor(() => {
      expect(mockIndexBook).toHaveBeenCalledTimes(1);
    });

    expect(mockIndexBook.mock.calls[0]?.[1]).toBe('vol-2');
  });
});
