import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { SystemSettings } from '@/types/settings';
import { DEFAULT_AI_SETTINGS } from '@/services/ai/constants';
import { DEFAULT_READSETTINGS } from '@/services/constants';
import type { ReaderIndexProgress } from '@/store/readerStore';

const {
  state,
  saveSettingsMock,
  setSettingsMock,
  setBookKeysMock,
  initViewStateMock,
  clearViewStateMock,
  recordSessionMock,
  startIndexingMock,
  updateIndexingProgressMock,
  finishIndexingMock,
  cancelIndexingMock,
  saveConfigMock,
  startBookIndexingMock,
  subscribeToIndexingRunMock,
  isBookIndexedMock,
  cancelBookIndexingMock,
} = vi.hoisted(() => {
  const state = {
    settings: {} as SystemSettings,
    bookKeys: [] as string[],
    bookDataByKey: {} as Record<
      string,
      { book: { hash: string; title: string }; bookDoc: { toc: unknown[] } }
    >,
    viewSettings: { focusMode: false } as { focusMode: boolean },
    indexingProgress: {} as Record<string, ReaderIndexProgress>,
  };
  const runtimeSubscribers = new Set<(event: unknown) => void>();

  return {
    state,
    saveSettingsMock: vi.fn().mockResolvedValue(undefined),
    setSettingsMock: vi.fn(),
    setBookKeysMock: vi.fn(),
    initViewStateMock: vi.fn().mockResolvedValue(undefined),
    clearViewStateMock: vi.fn(),
    recordSessionMock: vi.fn(),
    startIndexingMock: vi.fn(),
    updateIndexingProgressMock: vi.fn(),
    finishIndexingMock: vi.fn(),
    cancelIndexingMock: vi.fn(),
    saveConfigMock: vi.fn().mockResolvedValue(undefined),
    startBookIndexingMock: vi
      .fn()
      .mockImplementation(({ key, bookHash }: { key: string; bookHash: string }) => {
        const runId = 'run-1';
        const result = {
          status: 'complete' as const,
          chunksProcessed: 4,
          totalSections: 1,
          skippedSections: 0,
          errorMessages: [],
          durationMs: 1,
        };
        queueMicrotask(() => {
          for (const subscriber of runtimeSubscribers) {
            subscriber({
              type: 'progress',
              runId,
              scope: 'reader',
              key,
              bookHash,
              progress: { current: 1, total: 2, phase: 'chunking' },
            });
            subscriber({
              type: 'complete',
              runId,
              scope: 'reader',
              key,
              bookHash,
              result,
            });
          }
        });
        return { runId, promise: Promise.resolve(result) };
      }),
    subscribeToIndexingRunMock: vi.fn(
      (_scope: string, _key: string, subscriber: (event: unknown) => void) => {
        runtimeSubscribers.add(subscriber);
        return () => {
          runtimeSubscribers.delete(subscriber);
        };
      },
    ),
    isBookIndexedMock: vi.fn().mockResolvedValue(false),
    cancelBookIndexingMock: vi.fn(),
  };
});

vi.mock('next/navigation', () => ({
  useRouter: () => ({ push: vi.fn(), replace: vi.fn() }),
  useSearchParams: () => ({ get: () => null, toString: () => '' }),
}));

vi.mock('@/hooks/useTranslation', () => ({
  useTranslation: () => (value: string) => value,
}));

vi.mock('@/context/EnvContext', () => ({
  useEnv: () => ({
    envConfig: {},
    appService: { isDesktopApp: false, hasWindow: false },
  }),
}));

vi.mock('@/store/settingsStore', () => {
  const useSettingsStore = () => ({
    settings: state.settings,
    setSettings: setSettingsMock,
    saveSettings: saveSettingsMock,
    isSettingsDialogOpen: false,
    settingsDialogBookKey: '',
  });
  useSettingsStore.getState = () => ({ settings: state.settings });
  return { useSettingsStore };
});

vi.mock('@/store/bookDataStore', () => ({
  useBookDataStore: () => ({
    getBookData: (bookKey: string) => state.bookDataByKey[bookKey] ?? null,
    getConfig: () => ({}),
    saveConfig: saveConfigMock,
  }),
}));

vi.mock('@/store/readerStore', () => ({
  useReaderStore: () => ({
    getView: () => null,
    setBookKeys: setBookKeysMock,
    getViewSettings: () => state.viewSettings,
    initViewState: initViewStateMock,
    getViewState: () => ({ isPrimary: true }),
    clearViewState: clearViewStateMock,
    recordSession: recordSessionMock,
    startIndexing: startIndexingMock,
    updateIndexingProgress: updateIndexingProgressMock,
    finishIndexing: finishIndexingMock,
    cancelIndexing: cancelIndexingMock,
    indexingProgress: state.indexingProgress,
  }),
}));

vi.mock('@/store/sidebarStore', () => ({
  useSidebarStore: () => ({
    sideBarBookKey: state.bookKeys[0] ?? '',
    setSideBarBookKey: vi.fn(),
  }),
}));

vi.mock('@/app/reader/hooks/useBooksManager', () => ({
  default: () => ({
    bookKeys: state.bookKeys,
    dismissBook: vi.fn(),
    getNextBookKey: vi.fn(),
  }),
}));

vi.mock('@/hooks/useGamepad', () => ({
  useGamepad: () => undefined,
}));

vi.mock('@/app/reader/hooks/useBookShortcuts', () => ({
  default: () => undefined,
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

vi.mock('@/services/environment', () => ({
  isTauriAppPlatform: () => false,
}));
vi.mock('@/services/contextTranslation/sourceRouter', () => ({
  detectAIAvailability: () => ({ chat: true, embedding: true }),
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

vi.mock('@/components/metadata', () => ({
  BookDetailModal: () => null,
}));

vi.mock('@/components/Spinner', () => ({
  default: () => <div data-testid='spinner' />,
}));

vi.mock('@/components/settings/SettingsDialog', () => ({
  default: () => null,
}));

vi.mock('@/app/reader/components/sidebar/SideBar', () => ({
  default: () => null,
}));

vi.mock('@/app/reader/components/notebook/Notebook', () => ({
  default: () => null,
}));

vi.mock('@/app/reader/components/BooksGrid', () => ({
  default: () => <div data-testid='books-grid' />,
}));

vi.mock('@/services/ai/indexingRuntime', () => ({
  startBookIndexing: startBookIndexingMock,
  subscribeToIndexingRun: subscribeToIndexingRunMock,
}));

vi.mock('@/services/ai/ragService', () => ({
  isBookIndexed: isBookIndexedMock,
  cancelBookIndexing: cancelBookIndexingMock,
}));

import ProfileSwitcher from '@/app/reader/components/header/ProfileSwitcher';
import IndexBookButton from '@/app/reader/components/header/IndexBookButton';
import ReaderContent from '@/app/reader/components/ReaderContent';

beforeEach(() => {
  vi.clearAllMocks();
  state.settings = {
    aiSettings: {
      ...DEFAULT_AI_SETTINGS,
      enabled: true,
      providers: [],
      profiles: [
        { id: 'profile-default', name: 'Default', modelAssignments: {}, inferenceParamsByTask: {} },
        { id: 'profile-fast', name: 'Fast', modelAssignments: {}, inferenceParamsByTask: {} },
      ],
      activeProfileId: 'profile-default',
    },
    globalReadSettings: {
      ...DEFAULT_READSETTINGS,
      autoIndexOnOpen: true,
    },
    lastOpenBooks: ['reader'],
  } as unknown as SystemSettings;
  state.bookKeys = ['reader-key-1'];
  state.bookDataByKey = {
    'reader-key-1': {
      book: { hash: 'hash-1', title: 'Test Book' },
      bookDoc: { toc: [] },
    },
  };
  state.viewSettings = { focusMode: false };
  state.indexingProgress = {};
});

afterEach(() => {
  cleanup();
});

describe('reader header indexing controls', () => {
  it('persists the selected AI profile from the header switcher', async () => {
    render(<ProfileSwitcher />);

    fireEvent.change(screen.getByLabelText('AI Profile'), { target: { value: 'profile-fast' } });

    expect(setSettingsMock).toHaveBeenCalledWith(
      expect.objectContaining({
        aiSettings: expect.objectContaining({ activeProfileId: 'profile-fast' }),
      }),
    );
    await waitFor(() => expect(saveSettingsMock).toHaveBeenCalled());
  });

  it('starts manual indexing from the header button', async () => {
    render(<IndexBookButton bookKey='reader-key-1' />);

    fireEvent.click(screen.getByRole('button', { name: 'Index' }));

    await waitFor(() =>
      expect(startBookIndexingMock).toHaveBeenCalledWith(
        expect.objectContaining({
          scope: 'reader',
          key: 'reader-key-1',
          bookHash: 'hash-1',
          bookDoc: state.bookDataByKey['reader-key-1']!.bookDoc,
          aiSettings: state.settings.aiSettings,
        }),
      ),
    );
    expect(startIndexingMock).toHaveBeenCalledWith('reader-key-1', 'run-1');
    expect(updateIndexingProgressMock).toHaveBeenCalledWith(
      'reader-key-1',
      'run-1',
      expect.objectContaining({ current: 1, total: 2, phase: 'chunking' }),
    );
    expect(finishIndexingMock).toHaveBeenCalledWith('reader-key-1', 'run-1');
  });

  it('stops manual indexing using the active run id', async () => {
    state.indexingProgress = {
      'reader-key-1': {
        runId: 'run-42',
        current: 1,
        total: 2,
        phase: 'embedding',
      },
    };

    render(<IndexBookButton bookKey='reader-key-1' />);

    fireEvent.click(screen.getByRole('button', { name: 'Stop Index' }));

    expect(cancelBookIndexingMock).toHaveBeenCalledWith('run-42');
    expect(cancelBookIndexingMock).not.toHaveBeenCalledWith('hash-1');
    expect(cancelIndexingMock).toHaveBeenCalledWith('reader-key-1', 'run-42');
  });

  it('auto-indexes the primary book when opening the reader', async () => {
    render(<ReaderContent settings={state.settings} />);

    await waitFor(() => expect(isBookIndexedMock).toHaveBeenCalledWith('hash-1'));
    await waitFor(() =>
      expect(startBookIndexingMock).toHaveBeenCalledWith(
        expect.objectContaining({
          scope: 'reader',
          key: 'reader-key-1',
          bookHash: 'hash-1',
          bookDoc: state.bookDataByKey['reader-key-1']!.bookDoc,
          aiSettings: state.settings.aiSettings,
        }),
      ),
    );
    expect(startIndexingMock).toHaveBeenCalledWith('reader-key-1', 'run-1');
    expect(updateIndexingProgressMock).toHaveBeenCalledWith(
      'reader-key-1',
      'run-1',
      expect.objectContaining({ current: 1, total: 2, phase: 'chunking' }),
    );
    expect(finishIndexingMock).toHaveBeenCalledWith('reader-key-1', 'run-1');
  });
});
