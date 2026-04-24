import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';

import Notebook from '@/app/reader/components/notebook/Notebook';
import NotebookTabNavigation from '@/app/reader/components/notebook/NotebookTabNavigation';
import LookupHistoryView from '@/app/reader/components/sidebar/LookupHistoryView';
import { eventDispatcher } from '@/utils/event';
import { useNotebookStore } from '@/store/notebookStore';
import type { LookupHistoryEntry } from '@/services/contextTranslation/lookupHistoryService';

type MockBookConfig = {
  updatedAt?: number;
  notebookActiveTab?: 'notes' | 'ai' | 'vocabulary';
  booknotes?: unknown[];
  [key: string]: unknown;
};

type MockBookDataEntry = {
  book?: { hash: string };
  bookDoc?: { metadata: { language: string } };
  config?: MockBookConfig;
};

const mockSettings = {
  aiSettings: { enabled: false },
  globalReadSettings: {
    notebookWidth: '25%',
    isNotebookPinned: true,
    notebookActiveTab: 'notes' as 'notes' | 'ai' | 'vocabulary',
    contextTranslation: {
      enabled: false,
    },
  },
};

const mockAppService = {
  hasRoundedWindow: false,
  saveBookConfig: vi.fn(),
  saveLibraryBooks: vi.fn(),
};

const mockEnvConfig = {
  getAppService: vi.fn().mockResolvedValue(mockAppService),
};

const mockThemeState = {
  updateAppTheme: vi.fn(),
  safeAreaInsets: { top: 0 },
  systemUIVisible: false,
  statusBarHeight: 0,
};

const mockSidebarState = {
  sideBarBookKey: null as string | null,
};

const mockAIChatState = {
  activeConversationId: null as string | null,
};

let mockBookDataById: Record<string, MockBookDataEntry> = {};

const mockGetBookData = vi.fn((key: string) => {
  const id = key.split('-')[0]!;
  return mockBookDataById[id] ?? null;
});

const mockGetConfig = vi.fn((key: string | null) => {
  if (!key) return null;
  const id = key.split('-')[0]!;
  return mockBookDataById[id]?.config ?? null;
});

const mockSetConfig = vi.fn((key: string, partialConfig: Partial<MockBookConfig>) => {
  const id = key.split('-')[0]!;
  const entry = mockBookDataById[id];
  if (!entry?.config) return;
  entry.config = {
    ...entry.config,
    ...partialConfig,
  };
});

const mockSaveConfig = vi.fn(
  async (_envConfig: unknown, bookKey: string, config: MockBookConfig) => {
    const id = bookKey.split('-')[0]!;
    const entry = mockBookDataById[id];
    if (!entry) return;
    entry.config = {
      ...entry.config,
      ...config,
    };
  },
);

const mockUpdateBooknotes = vi.fn((key: string, booknotes: unknown[]) => {
  const id = key.split('-')[0]!;
  const entry = mockBookDataById[id];
  if (!entry) return undefined;
  entry.config = {
    ...(entry.config ?? {}),
    updatedAt: Date.now(),
    booknotes,
  };
  return entry.config;
});

const mockGetView = vi.fn();
const mockGetProgress = vi.fn();
const mockGetViewSettings = vi.fn();
const mockUpdateAppTheme = mockThemeState.updateAppTheme;
const mockSaveSettings = vi.fn();
const mockSetSettings = vi.fn();

vi.mock('@/hooks/useTranslation', () => ({
  useTranslation: () => (value: string) => value,
}));

vi.mock('@/context/EnvContext', () => ({
  useEnv: () => ({ envConfig: mockEnvConfig, appService: mockAppService }),
}));

vi.mock('@/store/settingsStore', () => ({
  useSettingsStore: () => ({
    settings: mockSettings,
    setSettings: mockSetSettings,
    saveSettings: mockSaveSettings,
  }),
}));

vi.mock('@/store/bookDataStore', () => ({
  useBookDataStore: () => ({
    getBookData: mockGetBookData,
    getConfig: mockGetConfig,
    setConfig: mockSetConfig,
    saveConfig: mockSaveConfig,
    updateBooknotes: mockUpdateBooknotes,
  }),
}));

vi.mock('@/store/readerStore', () => ({
  useReaderStore: () => ({
    getView: mockGetView,
    getProgress: mockGetProgress,
    getViewSettings: mockGetViewSettings,
  }),
}));

vi.mock('@/store/sidebarStore', () => ({
  useSidebarStore: () => mockSidebarState,
}));

vi.mock('@/store/themeStore', () => ({
  useThemeStore: () => mockThemeState,
}));

vi.mock('@/store/aiChatStore', () => ({
  useAIChatStore: () => mockAIChatState,
}));

vi.mock('@/hooks/useSwipeToDismiss', () => ({
  useSwipeToDismiss: () => ({
    panelRef: { current: null },
    overlayRef: { current: null },
    panelHeight: { current: 0 },
    handleVerticalDragStart: () => undefined,
  }),
}));

vi.mock('@/hooks/usePanelResize', () => ({
  usePanelResize: () => ({
    handleResizeStart: () => undefined,
    handleResizeKeyDown: () => undefined,
  }),
}));

vi.mock('@/hooks/useShortcuts', () => ({
  default: () => undefined,
}));

vi.mock('@/hooks/useResponsiveSize', () => ({
  useResponsiveSize: (size: number) => size,
}));

vi.mock('@/app/reader/components/notebook/AIAssistant', () => ({
  default: () => null,
}));

vi.mock('@/app/reader/components/notebook/VocabularyPanel', () => ({
  default: () => null,
}));

const mockGetLookupHistoryForBook = vi.fn();

vi.mock('@/services/contextTranslation/lookupHistoryService', () => ({
  getLookupHistoryForBook: (...args: unknown[]) => mockGetLookupHistoryForBook(...args),
}));

beforeEach(() => {
  useNotebookStore.setState({
    notebookWidth: '',
    isNotebookVisible: false,
    isNotebookPinned: false,
    notebookActiveBookKey: null,
    notebookActiveTab: 'notes',
    notebookActiveTabs: {},
    notebookNewAnnotation: null,
    notebookEditAnnotation: null,
    notebookAnnotationDrafts: {},
  });

  mockSettings.aiSettings.enabled = false;
  mockSettings.globalReadSettings = {
    notebookWidth: '25%',
    isNotebookPinned: true,
    notebookActiveTab: 'notes',
    contextTranslation: {
      enabled: false,
    },
  };

  mockSidebarState.sideBarBookKey = null;
  mockAIChatState.activeConversationId = null;
  mockBookDataById = {
    book: {
      book: { hash: 'book-hash' },
    },
    book1: {
      book: { hash: 'book1' },
      bookDoc: { metadata: { language: 'en' } },
      config: { updatedAt: 0 },
    },
  };

  mockGetBookData.mockClear();
  mockGetConfig.mockClear();
  mockSetConfig.mockClear();
  mockSaveConfig.mockClear();
  mockUpdateBooknotes.mockClear();
  mockGetView.mockReset();
  mockGetView.mockReturnValue({ goTo: vi.fn() });
  mockGetProgress.mockReset();
  mockGetProgress.mockReturnValue({ page: 1 });
  mockGetViewSettings.mockReset();
  mockGetViewSettings.mockReturnValue({ isEink: false, rtl: false });
  mockGetLookupHistoryForBook.mockReset();
  mockGetLookupHistoryForBook.mockReturnValue([]);
  mockSaveSettings.mockClear();
  mockSetSettings.mockClear();
  mockUpdateAppTheme.mockClear();
  mockAppService.saveBookConfig.mockClear();
  mockAppService.saveLibraryBooks.mockClear();
});

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

describe('NotebookStore per-book tab state', () => {
  test('keeps notebook tabs isolated per book while preserving one-argument compatibility', () => {
    const store = useNotebookStore.getState();

    store.setNotebookBookKey('book-a');
    store.setNotebookActiveTab('ai');
    store.setNotebookBookKey('book-b');
    store.setNotebookActiveTab('notes');

    expect(useNotebookStore.getState().notebookActiveTabs).toEqual({
      'book-a': 'ai',
      'book-b': 'notes',
    });

    store.setNotebookBookKey('book-a');
    expect(useNotebookStore.getState().notebookActiveTab).toBe('ai');

    store.setNotebookActiveTab('notes');
    expect(useNotebookStore.getState().notebookActiveTabs['book-a']).toBe('notes');
    expect(useNotebookStore.getState().notebookActiveTabs['book-b']).toBe('notes');
  });
});

describe('NotebookTabNavigation', () => {
  test('keeps Notes reachable when AI features are disabled', () => {
    const onTabChange = vi.fn();

    render(<NotebookTabNavigation activeTab='ai' onTabChange={onTabChange} />);

    const notesTab = screen.getByRole('button', { name: 'Notes' });
    expect(notesTab).toBeTruthy();
    expect(screen.queryByRole('button', { name: 'AI' })).toBeNull();

    fireEvent.click(notesTab);
    expect(onTabChange).toHaveBeenCalledWith('notes');
  });
});

describe('Notebook', () => {
  test('seeds the per-book tab from the legacy global default and restores it after reopen with a new reader key', async () => {
    mockSettings.aiSettings.enabled = true;
    mockSettings.globalReadSettings.notebookActiveTab = 'ai';
    mockSidebarState.sideBarBookKey = 'book1-view0';

    const { rerender } = render(<Notebook />);

    await waitFor(() => {
      expect(mockBookDataById['book1']!.config?.notebookActiveTab).toBe('ai');
    });
    expect(screen.getByRole('button', { name: 'AI' }).className).toContain('bg-base-300/85');
    expect(mockSetConfig).toHaveBeenCalledWith(
      'book1-view0',
      expect.objectContaining({ notebookActiveTab: 'ai' }),
    );

    fireEvent.click(screen.getByRole('button', { name: 'Notes' }));

    await waitFor(() => {
      expect(mockBookDataById['book1']!.config?.notebookActiveTab).toBe('notes');
    });
    expect(screen.getByRole('button', { name: 'Notes' }).className).toContain('bg-base-300/85');
    expect(mockSetConfig).toHaveBeenLastCalledWith(
      'book1-view0',
      expect.objectContaining({ notebookActiveTab: 'notes' }),
    );

    mockSidebarState.sideBarBookKey = 'book1-view1';
    rerender(<Notebook />);

    await waitFor(() => {
      expect(screen.getByRole('button', { name: 'Notes' }).className).toContain('bg-base-300/85');
    });
    expect(mockBookDataById['book1']!.config?.notebookActiveTab).toBe('notes');
    expect(screen.getByRole('button', { name: 'AI' }).className).not.toContain('bg-base-300/85');
  });

  test('coerces an invalid persisted AI tab to notes when AI is disabled', async () => {
    mockSettings.aiSettings.enabled = false;
    mockSettings.globalReadSettings.notebookActiveTab = 'notes';
    mockSidebarState.sideBarBookKey = 'book1-view0';
    mockBookDataById['book1']!.config = { updatedAt: 0, notebookActiveTab: 'ai' };

    render(<Notebook />);

    await waitFor(() => {
      expect(screen.getByRole('button', { name: 'Notes' }).className).toContain('bg-base-300/85');
    });
    expect(screen.queryByRole('button', { name: 'AI' })).toBeNull();
    expect(mockBookDataById['book1']!.config?.notebookActiveTab).toBe('ai');
  });
});

describe('LookupHistoryView', () => {
  test('uses the first useful result field in the preview and jumps to the saved location', async () => {
    const goTo = vi.fn();
    const navigateSpy = vi.spyOn(eventDispatcher, 'dispatch').mockResolvedValue(undefined);
    mockGetView.mockReturnValue({ goTo });

    const historyEntries: LookupHistoryEntry[] = [
      {
        id: 'hist-new',
        recordedAt: 2_000,
        bookHash: 'book-hash',
        term: 'lookup-beta',
        context: 'context beta',
        result: { translation: 'beta translation', simpleDefinition: 'beta summary' },
        mode: 'dictionary',
        location: 'epubcfi(/6/4:10)',
      },
      {
        id: 'hist-old',
        recordedAt: 1_000,
        bookHash: 'book-hash',
        term: 'lookup-alpha',
        context: 'context alpha',
        result: { translation: 'alpha translation', contextualMeaning: 'alpha meaning' },
        mode: 'translation',
        location: 'epubcfi(/6/2:0)',
      },
    ];
    mockGetLookupHistoryForBook.mockReturnValue(historyEntries);

    render(<LookupHistoryView bookKey='book-key' />);

    const betaRow = await screen.findByRole('button', { name: /lookup-beta/i });
    expect(screen.getByText('lookup-alpha')).toBeTruthy();
    expect(screen.getByText('context beta · beta summary')).toBeTruthy();
    expect(screen.getByText('context alpha · alpha meaning')).toBeTruthy();

    fireEvent.click(betaRow, { ctrlKey: true });

    expect(goTo).toHaveBeenCalledWith('epubcfi(/6/4:10)');
    expect(navigateSpy).toHaveBeenCalledWith('navigate', {
      bookKey: 'book-key',
      cfi: 'epubcfi(/6/4:10)',
    });
  });
});
