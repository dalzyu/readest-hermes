import { beforeEach, describe, expect, test, vi } from 'vitest';

const {
  mockGetAllSeries,
  mockGetSeriesForBook,
  mockSaveSeries,
  mockDeleteSeries,
  mockMigrateLegacySeriesRecords,
} = vi.hoisted(() => ({
  mockGetAllSeries: vi.fn(),
  mockGetSeriesForBook: vi.fn(),
  mockSaveSeries: vi.fn(),
  mockDeleteSeries: vi.fn(),
  mockMigrateLegacySeriesRecords: vi.fn(),
}));

vi.mock('@/services/ai/storage/aiStore', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/services/ai/storage/aiStore')>();

  return {
    ...actual,
    aiStore: {
      getAllSeries: mockGetAllSeries,
      getSeriesForBook: mockGetSeriesForBook,
      saveSeries: mockSaveSeries,
      deleteSeries: mockDeleteSeries,
      migrateLegacySeriesRecords: mockMigrateLegacySeriesRecords,
    },
  };
});

import type { BookSeries } from '@/services/contextTranslation/types';
import { normalizeSeriesRecord, normalizeSeriesRecords } from '@/services/ai/storage/aiStore';
import {
  getPriorVolumes,
  getSeriesForBook,
  migrateLegacySeriesRecords,
  updateSeriesVolume,
} from '@/services/contextTranslation/seriesService';

describe('seriesService', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  test('returns ordered prior volumes for the current book', async () => {
    mockGetSeriesForBook.mockResolvedValue({
      id: 'series-1',
      name: 'The Grey Castle',
      volumes: [
        { bookHash: 'vol-1', volumeIndex: 1, label: 'Vol. 1' },
        { bookHash: 'vol-2', volumeIndex: 2, label: 'Vol. 2' },
        { bookHash: 'vol-3', volumeIndex: 3, label: 'Vol. 3' },
      ],
      createdAt: 1,
      updatedAt: 1,
    } satisfies BookSeries);

    const prior = await getPriorVolumes('vol-3');

    expect(prior.map((volume) => volume.bookHash)).toEqual(['vol-1', 'vol-2']);
  });

  test('can update a book volume label and ordering', async () => {
    let allSeries: BookSeries[] = [
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
    mockGetAllSeries.mockImplementation(async () => allSeries);
    mockSaveSeries.mockImplementation(async (series: BookSeries) => {
      allSeries = [series];
    });
    mockGetSeriesForBook.mockImplementation(
      async (bookHash: string) =>
        allSeries.find((series) => series.volumes.some((volume) => volume.bookHash === bookHash)) ??
        null,
    );

    await updateSeriesVolume('series-1', 'vol-2', { volumeIndex: 4, label: 'Book 4' });
    const series = await getSeriesForBook('vol-2');

    expect(mockSaveSeries).toHaveBeenCalledWith(
      expect.objectContaining({
        volumes: expect.arrayContaining([
          expect.objectContaining({ bookHash: 'vol-2', volumeIndex: 4, label: 'Book 4' }),
        ]),
      }),
    );
    expect(series?.volumes.find((volume) => volume.bookHash === 'vol-2')?.label).toBe('Book 4');
  });

  test('migrates legacy bookHashes series rows to ordered volumes without losing order', () => {
    const series = normalizeSeriesRecord({
      id: 'legacy-series',
      name: 'Legacy Saga',
      bookHashes: ['vol-a', 'vol-b', 'vol-c'],
      createdAt: 1,
      updatedAt: 1,
    });

    expect(series.volumes.map((volume) => volume.bookHash)).toEqual(['vol-a', 'vol-b', 'vol-c']);
    expect(series.volumes.map((volume) => volume.volumeIndex)).toEqual([1, 2, 3]);
  });

  test('backfills all legacy series rows during migration sweep', async () => {
    const migrated = normalizeSeriesRecords([
      {
        id: 'legacy-1',
        name: 'Legacy One',
        bookHashes: ['a', 'b'],
        createdAt: 1,
        updatedAt: 1,
      },
      {
        id: 'legacy-2',
        name: 'Legacy Two',
        bookHashes: ['c'],
        createdAt: 1,
        updatedAt: 1,
      },
    ]);
    mockMigrateLegacySeriesRecords.mockResolvedValue(undefined);
    mockGetAllSeries.mockResolvedValue(migrated);

    await migrateLegacySeriesRecords();

    const all = await mockGetAllSeries();
    expect(mockMigrateLegacySeriesRecords).toHaveBeenCalled();
    expect(all.every((series: BookSeries) => 'volumes' in series)).toBe(true);
    expect(all.find((series: BookSeries) => series.id === 'legacy-1')?.volumes[1]?.volumeIndex).toBe(2);
  });
});
