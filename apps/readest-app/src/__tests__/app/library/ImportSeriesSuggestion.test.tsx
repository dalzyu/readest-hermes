import React from 'react';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, test, vi } from 'vitest';

import type { Book } from '@/types/book';
import type { BookSeries } from '@/services/contextTranslation/types';
import LibraryPage from '@/app/library/page';
import { buildImportSeriesSuggestions } from '@/utils/seriesSuggestions';
const mockSelectFiles = vi.fn();
const mockImportBook = vi.fn();
const mockGetAllSeries = vi.fn();
const mockAddBookToSeries = vi.fn();

let libraryState: Book[] = [
  {
    hash: 'vol-1',
    format: 'EPUB' as const,
    title: 'Grey Castle 1',
    author: 'Zhang San',
    createdAt: 1,
    updatedAt: 1,
  },
];

vi.mock('next/navigation', () => ({
  useSearchParams: () => ({ get: () => null, toString: () => '' }),
}));

vi.mock('@/hooks/useTranslation', () => ({
  useTranslation: () => (value: string, vars?: Record<string, string | number>) => {
    if (!vars) return value;
    return Object.entries(vars).reduce(
      (message, [key, replacement]) => message.replace(`{{${key}}}`, String(replacement)),
      value,
    );
  },
}));

vi.mock('@/context/EnvContext', () => ({
  useEnv: () => ({
    envConfig: {
      getAppService: async () => ({
        loadSettings: async () => ({ lastOpenBooks: [], openLastBooks: false }),
        loadLibraryBooks: async () => libraryState,
      }),
    },
    appService: {
      hasUpdater: false,
      hasWindow: false,
      isMobileApp: false,
      hasSafeAreaInset: false,
      hasRoundedWindow: false,
      importBook: (...args: unknown[]) => mockImportBook(...args),
      saveLibraryBooks: vi.fn(),
    },
  }),
}));

vi.mock('@/context/AuthContext', () => ({ useAuth: () => ({ token: null, user: null }) }));

vi.mock('@/store/themeStore', () => ({
  useThemeStore: () => ({
    safeAreaInsets: { top: 0, right: 0, bottom: 0, left: 0 },
    isRoundedWindow: false,
  }),
}));

vi.mock('@/store/settingsStore', () => ({
  useSettingsStore: () => ({
    settings: {
      globalViewSettings: {},
      autoUpload: false,
      alwaysOnTop: false,
      autoCheckUpdates: false,
      openLastBooks: false,
      lastOpenBooks: [],
    },
    setSettings: vi.fn(),
    saveSettings: vi.fn(),
    isSettingsDialogOpen: false,
    setSettingsDialogOpen: vi.fn(),
  }),
}));

vi.mock('@/store/bookDataStore', () => ({ useBookDataStore: () => ({ clearBookData: vi.fn() }) }));
vi.mock('@/store/transferStore', () => ({
  useTransferStore: () => ({ isTransferQueueOpen: false }),
}));

vi.mock('@/store/libraryStore', () => {
  const updateBooks = vi.fn(async (_envConfig: unknown, books: Book[]) => {
    libraryState = [...libraryState, ...books];
  });
  const setLibrary = vi.fn((books: Book[]) => {
    libraryState = books;
  });
  const useLibraryStore = () => ({
    library: libraryState,
    isSyncing: false,
    syncProgress: 0,
    updateBook: vi.fn(),
    updateBooks,
    setLibrary,
    getGroupId: () => '',
    getGroupName: () => '',
    refreshGroups: vi.fn(),
    checkOpenWithBooks: false,
    checkLastOpenBooks: false,
    setCheckOpenWithBooks: vi.fn(),
    setCheckLastOpenBooks: vi.fn(),
  });
  useLibraryStore.getState = () => ({ library: libraryState });
  return { useLibraryStore };
});

vi.mock('@/hooks/useResponsiveSize', () => ({ useResponsiveSize: () => 18 }));
vi.mock('@/hooks/usePullToRefresh', () => ({ usePullToRefresh: vi.fn() }));
vi.mock('@/hooks/useTheme', () => ({ useTheme: vi.fn() }));
vi.mock('@/hooks/useUICSS', () => ({ useUICSS: vi.fn() }));
vi.mock('@/app/library/hooks/useDemoBooks', () => ({ useDemoBooks: () => [] }));
vi.mock('@/app/library/hooks/useBooksSync', () => ({
  useBooksSync: () => ({ pullLibrary: vi.fn(), pushLibrary: vi.fn() }),
}));
vi.mock('@/hooks/useScreenWakeLock', () => ({ useScreenWakeLock: vi.fn() }));
vi.mock('@/hooks/useOpenWithBooks', () => ({ useOpenWithBooks: vi.fn() }));
vi.mock('@/hooks/useFileSelector', () => ({
  useFileSelector: () => ({ selectFiles: (...args: unknown[]) => mockSelectFiles(...args) }),
}));
vi.mock('@/utils/bridge', () => ({ lockScreenOrientation: vi.fn(), selectDirectory: vi.fn() }));
vi.mock('@/utils/permission', () => ({ requestStoragePermission: vi.fn() }));
vi.mock('@/services/constants', () => ({ SUPPORTED_BOOK_EXTS: ['epub'] }));
vi.mock('@/utils/window', () => ({
  tauriHandleClose: vi.fn(),
  tauriHandleSetAlwaysOnTop: vi.fn(),
  tauriHandleToggleFullScreen: vi.fn(),
  tauriQuitApp: vi.fn(),
}));
vi.mock('@/components/AboutWindow', () => ({ AboutWindow: () => null }));
vi.mock('@/components/metadata', () => ({ BookDetailModal: () => null }));
vi.mock('@/components/UpdaterWindow', () => ({ UpdaterWindow: () => null }));
vi.mock('@/app/library/components/OPDSDialog', () => ({ CatalogDialog: () => null }));
vi.mock('@/app/library/components/MigrateDataWindow', () => ({ MigrateDataWindow: () => null }));
vi.mock('@/app/library/hooks/useDragDropImport', () => ({
  useDragDropImport: () => ({ isDragging: false }),
}));
vi.mock('@/hooks/useTransferQueue', () => ({ useTransferQueue: vi.fn() }));
vi.mock('@/hooks/useAppRouter', () => ({ useAppRouter: () => ({ push: vi.fn() }) }));
vi.mock('@/components/Toast', () => ({ Toast: () => null }));
vi.mock('@/app/library/components/LibraryHeader', () => ({
  default: ({ onImportBooksFromFiles }: { onImportBooksFromFiles: () => void }) => (
    <button onClick={onImportBooksFromFiles}>Import Books</button>
  ),
}));
vi.mock('@/app/library/components/Bookshelf', () => ({ default: () => <div>bookshelf</div> }));
vi.mock('@/app/library/components/GroupHeader', () => ({ default: () => null }));
vi.mock('@/hooks/useShortcuts', () => ({ default: vi.fn() }));
vi.mock('@/components/DropIndicator', () => ({ default: () => null }));
vi.mock('@/components/settings/SettingsDialog', () => ({ default: () => null }));
vi.mock('@/components/ModalPortal', () => ({
  default: ({ children }: { children: React.ReactNode }) => <div>{children}</div>,
}));
vi.mock('@/app/library/components/TransferQueuePanel', () => ({ default: () => null }));
vi.mock('overlayscrollbars-react', () => ({
  OverlayScrollbarsComponent: ({ children }: { children: React.ReactNode }) => (
    <div>{children}</div>
  ),
}));

vi.mock('@/services/contextTranslation/seriesService', async (importOriginal) => {
  const actual =
    await importOriginal<typeof import('@/services/contextTranslation/seriesService')>();
  return {
    __esModule: true,
    ...actual,
    getAllSeries: () => mockGetAllSeries(),
    addBookToSeries: (...args: unknown[]) => mockAddBookToSeries(...args),
  };
});

describe('Import series suggestions', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    libraryState = [
      {
        hash: 'vol-1',
        format: 'EPUB' as const,
        title: 'Grey Castle 1',
        author: 'Zhang San',
        createdAt: 1,
        updatedAt: 1,
      },
    ];
  });

  test('shows an import-time confirmation when a newly imported book matches a series', async () => {
    mockSelectFiles.mockResolvedValue({
      files: [{ file: new File(['epub'], 'grey-castle-4.epub') }],
    });
    mockImportBook.mockResolvedValue({
      hash: 'vol-4',
      format: 'EPUB' as const,
      title: 'Grey Castle 4',
      author: 'Zhang San',
      createdAt: 2,
      updatedAt: 2,
    });
    mockGetAllSeries.mockResolvedValue([
      {
        id: 'series-1',
        name: 'Grey Castle',
        volumes: [{ bookHash: 'vol-1', volumeIndex: 1, label: 'Vol. 1' }],
        createdAt: 1,
        updatedAt: 1,
      },
    ]);

    render(<LibraryPage />);

    fireEvent.click(screen.getByRole('button', { name: 'Import Books' }));

    await waitFor(() => {
      expect(screen.getByText('Add to series?')).toBeTruthy();
    });

    expect(screen.getByText('Grey Castle')).toBeTruthy();
  });
});

describe('buildImportSeriesSuggestions — non-ASCII titles and authors', () => {
  const makeBook = (overrides: Partial<Book> = {}): Book => ({
    hash: 'book-' + Math.random().toString(36).slice(2),
    format: 'EPUB' as const,
    title: 'Book',
    author: 'Author',
    createdAt: 1,
    updatedAt: 1,
    ...overrides,
  });

  const makeSeries = (name: string, _author: string, volumes: string[]): BookSeries => ({
    id: 'series-' + Math.random().toString(36).slice(2),
    name,
    volumes: volumes.map((hash, i) => ({ bookHash: hash, volumeIndex: i + 1 })),
    createdAt: 1,
    updatedAt: 1,
  });

  test('CJK title — non-ASCII characters are stripped, no suggestion produced', () => {
    // normalizeSuggestionText uses /[^a-z0-9]+/gi which drops CJK characters.
    // Without an ASCII title, titleMatches is false → no suggestion.
    const importedBook = makeBook({ title: '三体', author: 'Liu Cixin' });
    const series: BookSeries[] = [makeSeries('Three Body', 'Liu Cixin', ['existing-1'])];
    const library: Book[] = [
      makeBook({ hash: 'existing-1', title: 'Three Body 1', author: 'Liu Cixin' }),
    ];

    const suggestions = buildImportSeriesSuggestions([importedBook], series, library);
    expect(suggestions).toHaveLength(0);
  });

  test('Arabic author name — non-ASCII characters stripped, no author match', () => {
    const importedBook = makeBook({ title: 'Cosmos 2', author: 'كارل ساغان' });
    const series: BookSeries[] = [makeSeries('Cosmos', 'Carl Sagan', ['existing-1'])];
    const library: Book[] = [
      makeBook({ hash: 'existing-1', title: 'Cosmos 1', author: 'Carl Sagan' }),
    ];

    const suggestions = buildImportSeriesSuggestions([importedBook], series, library);
    expect(suggestions).toHaveLength(0);
  });

  test('Cyrillic title — normalized to empty, no match', () => {
    const importedBook = makeBook({ title: 'Война и мир', author: 'Leo Tolstoy' });
    const series: BookSeries[] = [makeSeries('War and Peace', 'Leo Tolstoy', ['existing-1'])];
    const library: Book[] = [
      makeBook({ hash: 'existing-1', title: 'War and Peace 1', author: 'Leo Tolstoy' }),
    ];

    const suggestions = buildImportSeriesSuggestions([importedBook], series, library);
    expect(suggestions).toHaveLength(0);
  });
});
