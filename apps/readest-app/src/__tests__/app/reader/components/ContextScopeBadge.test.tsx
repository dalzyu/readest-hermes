import { cleanup, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest';

const testState = vi.hoisted(() => ({
  indexed: false,
  indexingProgress: {} as Record<
    string,
    {
      runId: string;
      current: number;
      total: number;
      phase: 'pending' | 'chunking' | 'embedding' | 'finalizing' | 'complete';
    }
  >,
  settings: {
    globalReadSettings: {
      contextTranslation: {
        sameBookRagEnabled: true,
        priorVolumeRagEnabled: true,
      },
    },
  },
  bookHash: 'book-1',
  series: {
    id: 'series-1',
    name: 'Series',
    volumes: [
      { bookHash: 'book-0', volumeIndex: 1, label: 'Vol. 1' },
      { bookHash: 'book-1', volumeIndex: 2, label: 'Vol. 2' },
    ],
    createdAt: 1,
    updatedAt: 1,
  },
}));

vi.mock('@/hooks/useTranslation', () => ({
  useTranslation: () => (value: string) => value,
}));

vi.mock('@/services/ai/ragService', () => ({
  isBookIndexed: vi.fn(async () => testState.indexed),
}));

vi.mock('@/services/contextTranslation/seriesService', () => ({
  getSeriesForBook: vi.fn(async () => testState.series),
}));

vi.mock('@/store/bookDataStore', () => ({
  useBookDataStore: () => ({
    getBookData: () => ({ book: { hash: testState.bookHash } }),
  }),
}));

vi.mock('@/store/settingsStore', () => ({
  useSettingsStore: () => ({ settings: testState.settings }),
}));

vi.mock('@/store/readerStore', () => ({
  useReaderStore: (
    selector: (state: { indexingProgress: typeof testState.indexingProgress }) => unknown,
  ) => selector({ indexingProgress: testState.indexingProgress }),
}));

import ContextScopeBadge from '@/app/reader/components/header/ContextScopeBadge';

afterEach(() => {
  cleanup();
});

describe('ContextScopeBadge', () => {
  beforeEach(() => {
    testState.indexed = false;
    testState.indexingProgress = {};
  });

  test('holds pre-run scope while indexing is active and refreshes on completion', async () => {
    const view = render(<ContextScopeBadge bookKey='reader-key-1' />);

    await waitFor(() => expect(screen.getByText('Local')).toBeTruthy());

    testState.indexingProgress = {
      'reader-key-1': {
        runId: 'run-1',
        current: 1,
        total: 3,
        phase: 'embedding',
      },
    };
    testState.indexed = true;
    view.rerender(<ContextScopeBadge bookKey='reader-key-1' />);

    expect(screen.getByText('Local')).toBeTruthy();

    testState.indexingProgress = {
      'reader-key-1': {
        runId: 'run-1',
        current: 3,
        total: 3,
        phase: 'complete',
      },
    };
    view.rerender(<ContextScopeBadge bookKey='reader-key-1' />);

    await waitFor(() => expect(screen.getByText('Series')).toBeTruthy());
  });

  test('snaps back to pre-run scope when indexing is cancelled', async () => {
    const view = render(<ContextScopeBadge bookKey='reader-key-1' />);

    await waitFor(() => expect(screen.getByText('Local')).toBeTruthy());

    testState.indexingProgress = {
      'reader-key-1': {
        runId: 'run-2',
        current: 1,
        total: 3,
        phase: 'chunking',
      },
    };
    testState.indexed = false;
    view.rerender(<ContextScopeBadge bookKey='reader-key-1' />);

    expect(screen.getByText('Local')).toBeTruthy();

    testState.indexingProgress = {};
    view.rerender(<ContextScopeBadge bookKey='reader-key-1' />);

    await waitFor(() => expect(screen.getByText('Local')).toBeTruthy());
  });
});
