import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest';

import SeriesModal from '@/app/library/components/SeriesModal';
import type { BookSeries } from '@/services/contextTranslation/types';
import type { Book } from '@/types/book';
import { eventDispatcher } from '@/utils/event';

const mockGetAllSeries = vi.fn();
const mockGetSeriesForBook = vi.fn();
const mockCreateSeries = vi.fn();
const mockAddBookToSeries = vi.fn();
const mockRemoveBookFromSeries = vi.fn();
const mockDeleteSeries = vi.fn();
const mockUpdateSeriesVolume = vi.fn();
const mockIsIndexed = vi.fn();
const mockStartBookIndexing = vi.fn();
const mockSubscribeToIndexingRun = vi.fn(
  (_scope: unknown, _key: unknown, _subscriber: unknown) => () => undefined,
);
const mockLoadBookContent = vi.fn();
const mockOpen = vi.fn();

const cloneSeries = (series: BookSeries): BookSeries => ({
  ...series,
  volumes: series.volumes.map((volume) => ({ ...volume })),
});

let seriesState: BookSeries[] = [];

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
  getAllSeries: (...args: unknown[]) => mockGetAllSeries(...args),
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

vi.mock('@/services/ai/indexingRuntime', () => ({
  startBookIndexing: (...args: unknown[]) => mockStartBookIndexing(...args),
  subscribeToIndexingRun: (scope: unknown, key: unknown, subscriber: unknown) =>
    mockSubscribeToIndexingRun(scope, key, subscriber),
}));

vi.mock('@/libs/document', () => ({
  DocumentLoader: class {
    open() {
      return mockOpen();
    }
  },
}));

afterEach(() => {
  cleanup();
});

describe('SeriesModal', () => {
  beforeEach(() => {
    vi.clearAllMocks();

    seriesState = [
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
    ];

    mockGetAllSeries.mockImplementation(async () => seriesState.map(cloneSeries));
    mockGetSeriesForBook.mockImplementation(async (bookHash: string) => {
      const series = seriesState.find((item) =>
        item.volumes.some((volume) => volume.bookHash === bookHash),
      );
      return series ? cloneSeries(series) : null;
    });
    mockCreateSeries.mockImplementation(async (name: string, bookHashes: string[]) => {
      const series: BookSeries = {
        id: `series-${seriesState.length + 1}`,
        name,
        volumes: bookHashes.map((bookHash, index) => ({
          bookHash,
          volumeIndex: index + 1,
          label: `Vol. ${index + 1}`,
        })),
        createdAt: 1,
        updatedAt: 1,
      };

      seriesState = [...seriesState, series];
      return cloneSeries(series);
    });
    mockAddBookToSeries.mockImplementation(async (seriesId: string, bookHash: string) => {
      seriesState = seriesState.map((series) => {
        if (series.id !== seriesId) return series;
        if (series.volumes.some((volume) => volume.bookHash === bookHash)) return series;
        const nextVolumeIndex = series.volumes.length + 1;
        return {
          ...series,
          volumes: [
            ...series.volumes,
            {
              bookHash,
              volumeIndex: nextVolumeIndex,
              label: `Vol. ${nextVolumeIndex}`,
            },
          ],
          updatedAt: 1,
        };
      });
    });
    mockRemoveBookFromSeries.mockImplementation(async (seriesId: string, bookHash: string) => {
      seriesState = seriesState.map((series) => {
        if (series.id !== seriesId) return series;
        return {
          ...series,
          volumes: series.volumes
            .filter((volume) => volume.bookHash !== bookHash)
            .map((volume, index) => ({ ...volume, volumeIndex: index + 1 })),
          updatedAt: 1,
        };
      });
    });
    mockDeleteSeries.mockImplementation(async (seriesId: string) => {
      seriesState = seriesState.filter((series) => series.id !== seriesId);
    });
    mockUpdateSeriesVolume.mockImplementation(
      async (
        seriesId: string,
        bookHash: string,
        patch: { volumeIndex?: number; label?: string },
      ) => {
        seriesState = seriesState.map((series) => {
          if (series.id !== seriesId) return series;
          return {
            ...series,
            volumes: series.volumes.map((volume) =>
              volume.bookHash === bookHash ? { ...volume, ...patch } : volume,
            ),
            updatedAt: 1,
          };
        });
      },
    );
    mockIsIndexed.mockImplementation(async (bookHash: string) => bookHash === 'vol-1');
    mockLoadBookContent.mockResolvedValue({ file: new File(['book'], 'book.epub') });
    mockOpen.mockResolvedValue({
      book: {
        metadata: { title: 'Grey Castle' },
        sections: [],
        toc: [],
      },
    });
    mockStartBookIndexing.mockImplementation(({ bookHash }: { bookHash: string }) => ({
      runId: `run-${bookHash}`,
      promise: Promise.resolve({
        status: 'complete' as const,
        chunksProcessed: 1,
        totalSections: 1,
        skippedSections: 0,
        errorMessages: [],
        durationMs: 1,
      }),
    }));
  });

  test('creates the new series before removing the old membership during reassignment', async () => {
    render(<SeriesModal />);

    await eventDispatcher.dispatch('manage-series', {
      hash: 'vol-2',
      title: 'Grey Castle 2',
    });

    await waitFor(() => {
      expect(screen.getByRole('heading', { name: 'The Grey Castle' })).toBeTruthy();
    });

    fireEvent.click(screen.getByRole('button', { name: 'New Series' }));
    fireEvent.change(screen.getByPlaceholderText('Series name'), {
      target: { value: 'The Grey Castle Reborn' },
    });
    fireEvent.click(screen.getByRole('button', { name: 'Create' }));

    await waitFor(() => {
      expect(mockCreateSeries).toHaveBeenCalledWith('The Grey Castle Reborn', ['vol-2']);
      expect(mockRemoveBookFromSeries).toHaveBeenCalledWith('series-1', 'vol-2');
      const createOrder = mockCreateSeries.mock.invocationCallOrder.at(0);
      const removeOrder = mockRemoveBookFromSeries.mock.invocationCallOrder.at(0);
      expect(createOrder).toBeDefined();
      expect(removeOrder).toBeDefined();
      expect(createOrder!).toBeLessThan(removeOrder!);
      expect(screen.getByRole('heading', { name: 'The Grey Castle Reborn' })).toBeTruthy();
    });
  });

  test('rolls back reassignment when removing the previous series membership fails', async () => {
    seriesState = [
      ...seriesState,
      {
        id: 'series-2',
        name: 'The Northern Road',
        volumes: [],
        createdAt: 1,
        updatedAt: 1,
      },
    ];

    render(<SeriesModal />);

    await eventDispatcher.dispatch('manage-series', {
      hash: 'vol-2',
      title: 'Grey Castle 2',
    });

    await waitFor(() => {
      expect(screen.getByRole('heading', { name: 'The Grey Castle' })).toBeTruthy();
    });

    mockRemoveBookFromSeries.mockRejectedValueOnce(new Error('failed to remove old series'));

    fireEvent.click(screen.getByRole('button', { name: 'The Northern Road' }));

    await waitFor(() => {
      expect(mockAddBookToSeries).toHaveBeenNthCalledWith(1, 'series-2', 'vol-2');
      expect(mockRemoveBookFromSeries).toHaveBeenNthCalledWith(1, 'series-1', 'vol-2');
      expect(mockRemoveBookFromSeries).toHaveBeenNthCalledWith(2, 'series-2', 'vol-2');
      expect(
        seriesState
          .find((series) => series.id === 'series-1')
          ?.volumes.some((volume) => volume.bookHash === 'vol-2'),
      ).toBe(true);
      expect(
        seriesState
          .find((series) => series.id === 'series-2')
          ?.volumes.some((volume) => volume.bookHash === 'vol-2'),
      ).toBe(false);
      expect(screen.getByRole('heading', { name: 'The Grey Castle' })).toBeTruthy();
    });
  });

  test('rolls back create-and-add when removing the previous series membership fails', async () => {
    render(<SeriesModal />);

    await eventDispatcher.dispatch('manage-series', {
      hash: 'vol-2',
      title: 'Grey Castle 2',
    });

    await waitFor(() => {
      expect(screen.getByRole('heading', { name: 'The Grey Castle' })).toBeTruthy();
    });

    mockRemoveBookFromSeries.mockRejectedValueOnce(new Error('failed to remove old series'));

    fireEvent.click(screen.getByRole('button', { name: 'New Series' }));
    fireEvent.change(screen.getByPlaceholderText('Series name'), {
      target: { value: 'The Grey Castle Reborn' },
    });
    fireEvent.click(screen.getByRole('button', { name: 'Create' }));

    await waitFor(() => {
      expect(mockCreateSeries).toHaveBeenCalledWith('The Grey Castle Reborn', ['vol-2']);
      expect(mockRemoveBookFromSeries).toHaveBeenCalledWith('series-1', 'vol-2');
      expect(mockDeleteSeries).toHaveBeenCalledWith('series-2');
      expect(
        seriesState
          .find((series) => series.id === 'series-1')
          ?.volumes.some((volume) => volume.bookHash === 'vol-2'),
      ).toBe(true);
      expect(seriesState.some((series) => series.name === 'The Grey Castle Reborn')).toBe(false);
      expect(screen.getByRole('heading', { name: 'The Grey Castle' })).toBeTruthy();
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
      expect(mockStartBookIndexing).toHaveBeenCalledTimes(1);
    });

    expect(mockStartBookIndexing).toHaveBeenCalledWith(
      expect.objectContaining({
        scope: 'library',
        key: 'vol-2',
        bookHash: 'vol-2',
      }),
    );
  });
});
