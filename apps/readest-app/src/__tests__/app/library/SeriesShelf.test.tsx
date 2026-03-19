import React from 'react';
import { render, screen, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, test, vi } from 'vitest';

import type { Book } from '@/types/book';
import SeriesShelf from '@/app/library/components/SeriesShelf';

const mockGetAllSeries = vi.fn();
const mockIsIndexed = vi.fn();

vi.mock('@/hooks/useTranslation', () => ({
  useTranslation: () => (value: string) => value,
}));

vi.mock('@/context/EnvContext', () => ({
  useEnv: () => ({ appService: null }),
}));

vi.mock('@/store/settingsStore', () => ({
  useSettingsStore: () => ({
    settings: {
      aiSettings: {},
    },
  }),
}));

vi.mock('@/services/contextTranslation/seriesService', () => ({
  getAllSeries: () => mockGetAllSeries(),
}));

vi.mock('@/services/ai/storage/aiStore', () => ({
  aiStore: {
    isIndexed: (bookHash: string) => mockIsIndexed(bookHash),
  },
}));

const makeBook = (overrides: Partial<Book> = {}): Book => ({
  hash: 'book-1',
  format: 'EPUB',
  title: 'Vol. 1',
  author: 'Zhang San',
  createdAt: 1,
  updatedAt: 1,
  ...overrides,
});

describe('SeriesShelf', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  test('renders ordered volumes and per-volume indexing state in My Series', async () => {
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
    mockIsIndexed.mockImplementation(async (bookHash: string) => bookHash === 'vol-1');

    render(
      <SeriesShelf
        libraryBooks={[
          makeBook({ hash: 'vol-1', title: 'Grey Castle 1' }),
          makeBook({ hash: 'vol-2', title: 'Grey Castle 2' }),
        ]}
      />,
    );

    await waitFor(() => {
      expect(screen.getByText('Indexed')).toBeTruthy();
    });

    expect(screen.getByText('The Grey Castle')).toBeTruthy();
    expect(screen.getByText('Vol. 1')).toBeTruthy();
    expect(screen.getByText('Indexed')).toBeTruthy();
    expect(screen.getByText('Not indexed')).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Index All' })).toBeTruthy();
  });
});
