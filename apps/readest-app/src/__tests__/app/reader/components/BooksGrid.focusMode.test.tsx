import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import type { SystemSettings } from '@/types/settings';

const bookKey = 'book-1';
const secondaryBookKey = 'book-2';

const {
  state,
  makeSettings,
  makeViewSettings,
  setGridInsetsMock,
  setViewSettingsMock,
  saveSettingsMock,
  setBookKeysMock,
  initViewStateMock,
} = vi.hoisted(() => {
  const makeViewSettings = (focusMode: boolean) => ({
    focusMode,
    showHeader: true,
    showFooter: true,
    showBarsOnScroll: true,
    scrolled: true,
    vertical: true,
    doubleBorder: true,
    gapPercent: 8,
    isEink: false,
    rtl: false,
    readingRulerEnabled: true,
    readingRulerLines: 3,
    readingRulerPosition: 25,
    readingRulerOpacity: 0.6,
    readingRulerColor: 'yellow',
    borderColor: '#222222',
  });

  const makeSettings = () =>
    ({
      globalReadSettings: { autoIndexOnOpen: false },
      aiSettings: { enabled: false },
    }) as unknown as SystemSettings;

  const state = {
    bookKeys: ['book-1'] as string[],
    settings: makeSettings(),
    bookDataByKey: {
      ['book-1']: {
        book: { title: 'Test Book', format: 'epub' },
        bookDoc: { toc: [] },
      },
      ['book-2']: {
        book: { title: 'Secondary Book', format: 'epub' },
        bookDoc: { toc: [] },
      },
    } as Record<string, { book: { title: string; format: string }; bookDoc: { toc: unknown[] } }>,
    configByKey: {
      ['book-1']: {},
      ['book-2']: {},
    } as Record<string, object>,
    progressByKey: {
      ['book-1']: {
        section: { current: 1 },
        pageinfo: { current: 1 },
        sectionLabel: 'Chapter 1',
      },
      ['book-2']: {
        section: { current: 2 },
        pageinfo: { current: 2 },
        sectionLabel: 'Chapter 2',
      },
    } as Record<
      string,
      { section: { current: number }; pageinfo: { current: number }; sectionLabel: string }
    >,
    viewStateByKey: {
      ['book-1']: {
        ribbonVisible: true,
        viewerKey: 'viewer-1',
        inited: true,
      },
      ['book-2']: {
        ribbonVisible: false,
        viewerKey: 'viewer-2',
        inited: true,
      },
    } as Record<string, { ribbonVisible: boolean; viewerKey: string; inited: boolean }>,
    viewSettingsByKey: {
      ['book-1']: makeViewSettings(false),
      ['book-2']: makeViewSettings(false),
    } as Record<string, Record<string, unknown>>,
    indexingProgress: {
      ['book-1']: {
        runId: 'run-1',
        current: 2,
        total: 4,
        phase: 'chunking',
      },
    },
  };

  return {
    state,
    makeSettings,
    makeViewSettings,
    setGridInsetsMock: vi.fn(),
    setViewSettingsMock: vi.fn((key: string, viewSettings: Record<string, unknown>) => {
      state.viewSettingsByKey[key] = viewSettings;
    }),
    saveSettingsMock: vi.fn().mockResolvedValue(undefined),
    setBookKeysMock: vi.fn(),
    initViewStateMock: vi.fn().mockResolvedValue(undefined),
  };
});

vi.mock('next/navigation', () => ({
  useRouter: () => ({ push: vi.fn(), replace: vi.fn() }),
  useSearchParams: () => ({ get: () => null, toString: () => '' }),
}));

vi.mock('@/context/EnvContext', () => ({
  useEnv: () => ({
    envConfig: {},
    appService: {
      hasRoundedWindow: false,
      isDesktopApp: false,
      isAndroidApp: false,
      hasWindow: false,
    },
  }),
}));

vi.mock('@/store/themeStore', () => ({
  useThemeStore: () => ({
    safeAreaInsets: { top: 12, right: 16, bottom: 20, left: 24 },
  }),
}));

vi.mock('@/store/settingsStore', () => {
  const useSettingsStore = () => ({
    settings: state.settings,
    saveSettings: saveSettingsMock,
    isSettingsDialogOpen: false,
    settingsDialogBookKey: '',
  });
  useSettingsStore.getState = () => ({ settings: state.settings });
  return { useSettingsStore };
});

vi.mock('@/store/readerStore', () => ({
  useReaderStore: () => ({
    bookKeys: state.bookKeys,
    getProgress: (key: string) => state.progressByKey[key] ?? null,
    getViewState: (key: string) => state.viewStateByKey[key] ?? null,
    getViewSettings: (key: string) => state.viewSettingsByKey[key] ?? null,
    indexingProgress: state.indexingProgress,
    setGridInsets: setGridInsetsMock,
    hoveredBookKey: null,
    setBookKeys: setBookKeysMock,
    setViewSettings: setViewSettingsMock,
    initViewState: initViewStateMock,
    getView: () => null,
    clearViewState: vi.fn(),
    recordSession: vi.fn(),
    startIndexing: vi.fn(),
    updateIndexingProgress: vi.fn(),
    finishIndexing: vi.fn(),
    cancelIndexing: vi.fn(),
  }),
}));

vi.mock('@/store/sidebarStore', () => ({
  useSidebarStore: () => ({
    sideBarBookKey: state.bookKeys[0] ?? '',
    setSideBarBookKey: vi.fn(),
  }),
}));

vi.mock('@/store/bookDataStore', () => ({
  useBookDataStore: () => ({
    getConfig: (key: string) => state.configByKey[key] ?? null,
    getBookData: (key: string) => state.bookDataByKey[key] ?? null,
    saveConfig: vi.fn().mockResolvedValue(undefined),
  }),
}));

vi.mock('@/hooks/useTranslation', () => ({
  useTranslation: () => (value: string) => value,
}));

vi.mock('@/utils/grid', () => ({
  getGridTemplate: () => ({ columns: '1fr', rows: '1fr' }),
  getInsetEdges: () => ({ top: true, right: true, bottom: true, left: true }),
}));

vi.mock('@/utils/insets', () => ({
  getViewInsets: () => ({ top: 8, right: 8, bottom: 8, left: 8 }),
}));

vi.mock('@/app/reader/components/FoliateViewer', () => ({
  default: () => <div data-testid='foliate-viewer' />,
}));

vi.mock('@/app/reader/components/HeaderBar', () => ({
  default: () => <div data-testid='header-bar' />,
}));

vi.mock('@/app/reader/components/PageNavigationButtons', () => ({
  default: () => <div data-testid='page-navigation-buttons' />,
}));

vi.mock('@/app/reader/components/footerbar/FooterBar', () => ({
  default: () => <div data-testid='footer-bar' />,
}));

vi.mock('@/app/reader/components/ProgressBar', () => ({
  default: () => <div data-testid='progress-bar' />,
}));

vi.mock('@/app/reader/components/Ribbon', () => ({
  default: () => <div data-testid='ribbon' />,
}));

vi.mock('@/app/reader/components/annotator/Annotator', () => ({
  default: () => <div data-testid='annotator' />,
}));

vi.mock('@/app/reader/components/FootnotePopup', () => ({
  default: () => <div data-testid='footnote-popup' />,
}));

vi.mock('@/app/reader/components/HintInfo', () => ({
  default: () => <div data-testid='hint-info' />,
}));

vi.mock('@/app/reader/components/ReadingRuler', () => ({
  default: () => <div data-testid='reading-ruler' />,
}));

vi.mock('@/app/reader/components/DoubleBorder', () => ({
  default: () => <div data-testid='double-border' />,
}));

vi.mock('@/app/reader/components/sidebar/SearchResultsNav', () => ({
  default: () => <div data-testid='search-results-nav' />,
}));

vi.mock('@/app/reader/components/sidebar/BooknotesNav', () => ({
  default: () => <div data-testid='booknotes-nav' />,
}));

vi.mock('@/app/reader/components/IndexingProgressBar', () => ({
  default: () => <div data-testid='indexing-progress-bar' />,
}));

vi.mock('@/components/metadata', () => ({
  BookDetailModal: () => null,
}));

vi.mock('@/components/settings/SettingsDialog', () => ({
  default: () => null,
}));

vi.mock('@/app/reader/components/sidebar/SideBar', () => ({
  default: () => <div data-testid='sidebar' />,
}));

vi.mock('@/app/reader/components/notebook/Notebook', () => ({
  default: () => <div data-testid='notebook' />,
}));

vi.mock('@/hooks/useGamepad', () => ({
  useGamepad: () => undefined,
}));

vi.mock('@/app/reader/hooks/useBookShortcuts', () => ({
  default: () => undefined,
}));

vi.mock('@/app/reader/hooks/useBooksManager', () => ({
  default: () => ({
    bookKeys: state.bookKeys,
    dismissBook: vi.fn(),
    getNextBookKey: vi.fn(),
  }),
}));

vi.mock('@/services/environment', () => ({
  isTauriAppPlatform: () => false,
}));

vi.mock('@/helpers/openWith', () => ({
  parseOpenWithFiles: vi.fn().mockResolvedValue([]),
}));

vi.mock('@tauri-apps/api/window', () => ({
  getCurrentWindow: () => ({ label: 'main', close: vi.fn().mockResolvedValue(undefined) }),
}));

vi.mock('@/utils/window', () => ({
  tauriHandleClose: vi.fn().mockResolvedValue(undefined),
  tauriHandleOnCloseWindow: vi.fn().mockResolvedValue(() => undefined),
}));

vi.mock('@/utils/nav', () => ({
  navigateToLibrary: vi.fn(),
}));

vi.mock('@/utils/discord', () => ({
  clearDiscordPresence: vi.fn().mockResolvedValue(undefined),
}));

vi.mock('@/utils/event', () => ({
  eventDispatcher: {
    on: vi.fn(),
    off: vi.fn(),
    onSync: vi.fn(),
    offSync: vi.fn(),
    dispatch: vi.fn(),
  },
}));

vi.mock('@/services/ai/indexingRuntime', () => ({
  startBookIndexing: vi.fn(),
  subscribeToIndexingRun: vi.fn(),
}));

vi.mock('@/services/ai/ragService', () => ({
  isBookIndexed: vi.fn(),
  cancelBookIndexing: vi.fn(),
}));

import BooksGrid from '@/app/reader/components/BooksGrid';
import ReaderContent from '@/app/reader/components/ReaderContent';

afterEach(() => {
  cleanup();
});

beforeEach(() => {
  vi.clearAllMocks();
  state.bookKeys = [bookKey];
  state.settings = makeSettings();
  state.viewSettingsByKey[bookKey] = makeViewSettings(false);
  state.viewSettingsByKey[secondaryBookKey] = makeViewSettings(false);
});

describe('BooksGrid focus mode chrome policy', () => {
  it('renders the reader chrome when focus mode is off', () => {
    render(<BooksGrid bookKeys={state.bookKeys} onCloseBook={vi.fn()} onGoToLibrary={vi.fn()} />);

    expect(screen.getByTestId('foliate-viewer')).not.toBeNull();
    expect(screen.getByTestId('header-bar')).not.toBeNull();
    expect(screen.getByTestId('page-navigation-buttons')).not.toBeNull();
    expect(screen.getByTestId('footer-bar')).not.toBeNull();
    expect(screen.getByTestId('progress-bar')).not.toBeNull();
    expect(screen.getByTestId('ribbon')).not.toBeNull();
    expect(screen.getByTestId('hint-info')).not.toBeNull();
    expect(screen.getByTestId('reading-ruler')).not.toBeNull();
    expect(screen.getByTestId('annotator')).not.toBeNull();
    expect(screen.getByTestId('search-results-nav')).not.toBeNull();
    expect(screen.getByTestId('booknotes-nav')).not.toBeNull();
    expect(screen.getByTestId('footnote-popup')).not.toBeNull();
    expect(screen.getByTestId('double-border')).not.toBeNull();
    expect(screen.getByTestId('indexing-progress-bar')).not.toBeNull();
  });

  it('hides non-essential overlays in focus mode while leaving the viewer visible', () => {
    state.viewSettingsByKey[bookKey] = {
      ...state.viewSettingsByKey[bookKey],
      focusMode: true,
    };

    render(<BooksGrid bookKeys={state.bookKeys} onCloseBook={vi.fn()} onGoToLibrary={vi.fn()} />);

    expect(screen.getByTestId('foliate-viewer')).not.toBeNull();

    for (const testId of [
      'header-bar',
      'page-navigation-buttons',
      'footer-bar',
      'progress-bar',
      'ribbon',
      'hint-info',
      'reading-ruler',
      'annotator',
      'search-results-nav',
      'booknotes-nav',
      'footnote-popup',
      'double-border',
      'indexing-progress-bar',
    ]) {
      expect(screen.queryByTestId(testId)).toBeNull();
    }
  });
});

describe('ReaderContent focus mode chrome policy', () => {
  it('keeps shared chrome visible until a secondary book enters focus mode', () => {
    state.bookKeys = [bookKey, secondaryBookKey];
    state.viewSettingsByKey[bookKey] = makeViewSettings(false);
    state.viewSettingsByKey[secondaryBookKey] = makeViewSettings(false);

    const { rerender } = render(<ReaderContent settings={state.settings} />);

    expect(screen.getByTestId('sidebar')).not.toBeNull();
    expect(screen.getByTestId('notebook')).not.toBeNull();
    expect(screen.queryByRole('button', { name: /Exit focus mode/i })).toBeNull();

    state.viewSettingsByKey[secondaryBookKey] = makeViewSettings(true);
    rerender(<ReaderContent settings={state.settings} />);

    expect(screen.queryByTestId('sidebar')).toBeNull();
    expect(screen.queryByTestId('notebook')).toBeNull();
    expect(screen.getByRole('button', { name: /Exit focus mode/i })).not.toBeNull();
  });

  it('clears focus mode from every focused book when exiting focus mode', () => {
    state.bookKeys = [bookKey, secondaryBookKey];
    state.viewSettingsByKey[bookKey] = makeViewSettings(true);
    state.viewSettingsByKey[secondaryBookKey] = makeViewSettings(true);

    const { rerender } = render(<ReaderContent settings={state.settings} />);

    fireEvent.click(screen.getByRole('button', { name: /Exit focus mode/i }));

    expect(setViewSettingsMock).toHaveBeenCalledTimes(2);
    expect(setViewSettingsMock).toHaveBeenCalledWith(
      bookKey,
      expect.objectContaining({ focusMode: false }),
    );
    expect(setViewSettingsMock).toHaveBeenCalledWith(
      secondaryBookKey,
      expect.objectContaining({ focusMode: false }),
    );

    rerender(<ReaderContent settings={state.settings} />);

    expect(screen.getByTestId('sidebar')).not.toBeNull();
    expect(screen.getByTestId('notebook')).not.toBeNull();
    expect(screen.queryByRole('button', { name: /Exit focus mode/i })).toBeNull();
  });
});
