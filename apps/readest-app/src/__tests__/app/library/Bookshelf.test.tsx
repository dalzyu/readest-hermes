import React from 'react';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest';

import type { Book } from '@/types/book';
import Bookshelf from '@/app/library/components/Bookshelf';
import { readingStatsService } from '@/services/readingStats/readingStatsService';
import { navigateToLibrary } from '@/utils/nav';

const searchParamsState = vi.hoisted(() => ({}) as Record<string, string>);

vi.mock('next/navigation', () => ({
  useRouter: () => ({ push: vi.fn() }),
  useSearchParams: () => ({
    get: (key: string) => searchParamsState[key] ?? null,
    toString: () => new URLSearchParams(searchParamsState).toString(),
  }),
}));

vi.mock('@/hooks/useTranslation', () => ({
  useTranslation: () => (value: string) => value,
}));

vi.mock('@/context/EnvContext', () => ({
  useEnv: () => ({ envConfig: {}, appService: { hasWindow: false } }),
}));

vi.mock('@/store/themeStore', () => ({
  useThemeStore: () => ({ safeAreaInsets: { bottom: 0 } }),
}));

vi.mock('@/hooks/useAutoFocus', () => ({
  useAutoFocus: () => ({ current: null }),
}));

vi.mock('@/store/settingsStore', () => ({
  useSettingsStore: () => ({
    settings: {
      libraryViewMode: 'grid',
      librarySortBy: 'updated',
      librarySortAscending: false,
      libraryGroupBy: 'group',
      libraryCoverFit: 'crop',
      libraryAutoColumns: true,
      libraryColumns: 3,
      openBookInNewWindow: false,
      localBooksDir: '',
    },
  }),
}));

vi.mock('@/store/libraryStore', () => ({
  useLibraryStore: () => ({
    setCurrentBookshelf: vi.fn(),
    setLibrary: vi.fn(),
    updateBooks: vi.fn(),
    setSelectedBooks: vi.fn(),
    getSelectedBooks: () => [],
    toggleSelectedBook: vi.fn(),
    getGroupName: () => '',
  }),
}));

vi.mock('@/hooks/useResponsiveSize', () => ({
  useResponsiveSize: () => 15,
}));

vi.mock('@/utils/nav', () => ({
  navigateToLibrary: vi.fn(),
  navigateToReader: vi.fn(),
  showReaderWindow: vi.fn(),
}));

vi.mock('@/utils/event', () => ({
  eventDispatcher: {
    on: vi.fn(),
    off: vi.fn(),
    dispatch: vi.fn(),
  },
}));

vi.mock('@/components/Alert', () => ({
  default: () => null,
}));

vi.mock('@/components/Spinner', () => ({
  default: () => null,
}));

vi.mock('@/components/ModalPortal', () => ({
  default: ({ children }: { children: React.ReactNode }) => <div>{children}</div>,
}));

vi.mock('@/app/library/components/BookshelfItem', () => ({
  default: () => (
    <div
      className='book-item library-grid-item flex h-full flex-col justify-end'
      data-testid='bookshelf-item-root'
    >
      <button className='bookitem-main aspect-[28/41] w-full' type='button'>
        mocked-book-item
      </button>
      <div
        data-testid='bookshelf-item-footer'
        className='flex items-center justify-end'
        style={{ height: '15px', minHeight: '15px' }}
      />
    </div>
  ),
  generateBookshelfItems: (books: Book[]) => books,
}));
vi.mock('@/app/library/components/SelectModeActions', () => ({
  default: () => null,
}));

vi.mock('@/app/library/components/GroupingModal', () => ({
  default: () => null,
}));

vi.mock('@/app/library/components/SeriesModal', () => ({
  default: () => null,
}));

vi.mock('@/app/library/components/SeriesShelf', () => ({
  default: () => <div>No series yet.</div>,
}));

vi.mock('@/services/readingStats/readingStatsService', () => ({
  readingStatsService: {
    getDailyStats: vi.fn(),
    getGoals: vi.fn().mockReturnValue({ timeGoalMinutes: 0, pageGoal: 0 }),
    setGoals: vi.fn(),
    getCurrentStreak: vi.fn().mockReturnValue(0),
  },
}));

vi.mock('@/app/library/components/SetStatusAlert', () => ({
  default: () => null,
}));

const mockGetDailyStats = vi.mocked(readingStatsService.getDailyStats);
const mockNavigateToLibrary = vi.mocked(navigateToLibrary);

const makeBook = (overrides: Partial<Book> = {}): Book => ({
  hash: 'book-1',
  format: 'EPUB',
  title: 'Book One',
  author: 'Author One',
  createdAt: 1,
  updatedAt: 1,
  ...overrides,
});

const clearSearchParamsState = () => {
  Object.keys(searchParamsState).forEach((key) => {
    delete searchParamsState[key];
  });
};

const renderBookshelf = (params: Record<string, string | undefined> = {}) => {
  clearSearchParamsState();
  Object.entries(params).forEach(([key, value]) => {
    if (value !== undefined) {
      searchParamsState[key] = value;
    }
  });

  return render(
    <Bookshelf
      libraryBooks={[makeBook()]}
      isSelectMode={false}
      isSelectAll={false}
      isSelectNone={false}
      handleImportBooks={vi.fn()}
      handleBookUpload={vi.fn(async () => true)}
      handleBookDownload={vi.fn(async () => true)}
      handleBookDelete={vi.fn(async () => true)}
      handleSetSelectMode={vi.fn()}
      handleShowDetailsBook={vi.fn()}
      handleLibraryNavigation={vi.fn()}
      handlePushLibrary={vi.fn(async () => undefined)}
      booksTransferProgress={{}}
    />,
  );
};

describe('Bookshelf', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockGetDailyStats.mockReset();
    mockGetDailyStats.mockReturnValue([]);
    clearSearchParamsState();
  });

  afterEach(() => {
    cleanup();
  });

  test('renders the surface switch in a full-height layout', () => {
    const { container } = renderBookshelf({ surface: 'books' });

    const root = container.firstChild as HTMLElement;

    expect(root.classList.contains('flex')).toBe(true);
    expect(root.classList.contains('h-full')).toBe(true);
    expect(root.classList.contains('min-h-full')).toBe(true);
    expect(root.classList.contains('flex-col')).toBe(true);
    expect(screen.getByRole('button', { name: 'My Books' })).toBeTruthy();
    expect(screen.getByRole('button', { name: 'My Series' })).toBeTruthy();
  });

  test('shows the reading stats card on the top-level books surface', async () => {
    mockGetDailyStats.mockReturnValue([
      { date: '2024-01-15', totalSecondsRead: 59, totalPagesRead: 1, sessions: 1 },
    ]);

    const { container } = renderBookshelf({ surface: 'books' });

    expect(await screen.findByRole('heading', { name: 'Reading stats' })).toBeTruthy();
    expect(container.querySelector('.bookshelf-items > article')).toBeTruthy();
  });

  test('renders import tile with grid-aligned padding and footer spacer', () => {
    const { container } = renderBookshelf({ surface: 'books' });

    const importTile = container.querySelector('.bookshelf-import-item') as HTMLElement | null;
    expect(importTile).not.toBeNull();
    expect(importTile?.className.startsWith('book-item bookshelf-import-item ')).toBe(true);
    expect(importTile?.className.includes('px-')).toBe(true);
    expect(importTile?.className.includes('mx-')).toBe(false);

    const importFooter = importTile?.querySelector('[data-import-footer]') as HTMLElement | null;
    const regularFooter = screen.getByTestId('bookshelf-item-footer');
    expect(importFooter).not.toBeNull();
    expect(importFooter?.style.height).toBe(regularFooter.style.height);
    expect(importFooter?.style.minHeight).toBe(regularFooter.style.minHeight);
  });

  test('shows the reading stats card in zero-state so new users can set goals', () => {
    mockGetDailyStats.mockReturnValue([]);

    renderBookshelf({ surface: 'books' });

    expect(screen.queryByRole('heading', { name: 'Reading stats' })).toBeTruthy();
  });

  test.each([
    { name: 'series surface', params: { surface: 'series' } },
    { name: 'search results', params: { surface: 'books', q: 'search term' } },
    { name: 'group drill-in', params: { surface: 'books', group: 'group-1' } },
  ])('hides the reading stats card in $name', ({ params }) => {
    renderBookshelf(params);

    expect(screen.queryByRole('heading', { name: 'Reading stats' })).toBeNull();
    expect(screen.queryByText('From saved reading sessions')).toBeNull();
  });
  test('switching from My Series to My Books clears series-only params', () => {
    renderBookshelf({ surface: 'series', groupBy: 'series', group: 'series-1' });

    fireEvent.click(screen.getByRole('button', { name: 'My Books' }));

    expect(mockNavigateToLibrary).toHaveBeenCalled();
    const latestQuery = mockNavigateToLibrary.mock.calls.at(-1)?.[1];
    expect(latestQuery).toBe('surface=books');
  });

  test('switching from My Books to My Series sets explicit surface mode', () => {
    renderBookshelf({ surface: 'books' });

    fireEvent.click(screen.getByRole('button', { name: 'My Series' }));

    expect(mockNavigateToLibrary).toHaveBeenCalled();
    const latestQuery = mockNavigateToLibrary.mock.calls.at(-1)?.[1];
    expect(latestQuery).toBe('surface=series');
  });
});
