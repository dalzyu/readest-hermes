import { describe, test, expect, vi, beforeEach } from 'vitest';
import type { FoliateView } from '@/types/view';
import type { Insets } from '@/types/misc';
import type { BookProgress, ViewSettings } from '@/types/book';

vi.mock('@/store/bookDataStore', async () => {
  const { create } = await import('zustand');
  return {
    useBookDataStore: create(() => ({
      booksData: {} as Record<string, unknown>,
    })),
  };
});

vi.mock('@/store/settingsStore', () => {
  const { create } = require('zustand');
  return {
    useSettingsStore: create(() => ({
      settings: {},
    })),
  };
});

vi.mock('@/store/libraryStore', () => {
  const { create } = require('zustand');
  return {
    useLibraryStore: create(() => ({
      library: [],
      setLibrary: vi.fn(),
    })),
  };
});

vi.mock('@/utils/misc', () => ({
  uniqueId: vi.fn(() => 'mock-uid-123'),
}));

// These are transitive imports needed by readerStore
vi.mock('@/utils/toc', () => ({ updateToc: vi.fn() }));
vi.mock('@/utils/book', () => ({
  formatTitle: vi.fn((t: string) => t),
  getMetadataHash: vi.fn(() => 'hash'),
  getPrimaryLanguage: vi.fn(() => 'en'),
}));
vi.mock('@/utils/path', () => ({
  getBaseFilename: vi.fn((n: string) => n),
}));
vi.mock('@/services/constants', () => ({
  SUPPORTED_LANGNAMES: {},
}));
vi.mock('@/libs/document', () => ({
  DocumentLoader: vi.fn(),
}));

const mockReadingStatsRecordSession = vi.fn();
vi.mock('@/services/readingStats/readingStatsService', () => ({
  readingStatsService: {
    recordSession: (...args: unknown[]) => mockReadingStatsRecordSession(...args),
  },
}));

import { useReaderStore } from '@/store/readerStore';
import { useBookDataStore } from '@/store/bookDataStore';

/**
 * Helper to seed a minimal ViewState in the store for a given key.
 */
function seedViewState(
  key: string,
  overrides: Record<string, unknown> & { bookHash?: string } = {},
) {
  const { bookHash = key, ...viewStateOverrides } = overrides;
  useReaderStore.setState((state) => ({
    viewStates: {
      ...state.viewStates,
      [key]: {
        key,
        bookHash,
        view: null,
        viewerKey: `${key}-viewer`,
        isPrimary: true,
        loading: false,
        inited: false,
        error: null,
        progress: null,
        ribbonVisible: false,
        ttsEnabled: false,
        syncing: false,
        gridInsets: null,
        viewSettings: null,
        sessionStartedAt: null,
        sessionStartPage: null,
        ...viewStateOverrides,
      },
    },
  }));
}

function setDocumentVisibilityState(visibilityState: 'visible' | 'hidden') {
  Object.defineProperty(document, 'visibilityState', {
    configurable: true,
    value: visibilityState,
  });
}

function setViewCurrentPage(key: string, currentPage: number) {
  useReaderStore.setState((state) => ({
    viewStates: {
      ...state.viewStates,
      [key]: {
        ...state.viewStates[key]!,
        progress: {
          pageinfo: { current: currentPage },
        } as BookProgress,
      },
    },
  }));
}

describe('readerStore', () => {
  beforeEach(() => {
    useReaderStore.setState({
      viewStates: {},
      bookKeys: [],
      hoveredBookKey: null,
      indexingProgress: {},
    });
    useBookDataStore.setState({ booksData: {} });
    mockReadingStatsRecordSession.mockReset();
    mockReadingStatsRecordSession.mockReturnValue(true);
    setDocumentVisibilityState('visible');
  });

  describe('initial state', () => {
    test('has empty viewStates and bookKeys', () => {
      const state = useReaderStore.getState();
      expect(state.viewStates).toEqual({});
      expect(state.bookKeys).toEqual([]);
      expect(state.hoveredBookKey).toBeNull();
    });
  });

  describe('setBookKeys', () => {
    test('sets bookKeys array', () => {
      useReaderStore.getState().setBookKeys(['book-1', 'book-2']);
      expect(useReaderStore.getState().bookKeys).toEqual(['book-1', 'book-2']);
    });

    test('replaces existing bookKeys', () => {
      useReaderStore.getState().setBookKeys(['a']);
      useReaderStore.getState().setBookKeys(['b', 'c']);
      expect(useReaderStore.getState().bookKeys).toEqual(['b', 'c']);
    });
  });

  describe('setHoveredBookKey', () => {
    test('sets hovered book key', () => {
      useReaderStore.getState().setHoveredBookKey('book-1');
      expect(useReaderStore.getState().hoveredBookKey).toBe('book-1');
    });

    test('can be set to null', () => {
      useReaderStore.getState().setHoveredBookKey('book-1');
      useReaderStore.getState().setHoveredBookKey(null);
      expect(useReaderStore.getState().hoveredBookKey).toBeNull();
    });
  });

  describe('getView / setView', () => {
    test('getView returns null for missing key', () => {
      expect(useReaderStore.getState().getView('nonexistent')).toBeNull();
    });

    test('getView returns null for null key', () => {
      expect(useReaderStore.getState().getView(null)).toBeNull();
    });

    test('setView stores a view and getView retrieves it', () => {
      const key = 'abc-0';
      seedViewState(key);

      const mockView = { tagName: 'FOLIATE-VIEW' } as unknown as FoliateView;
      useReaderStore.getState().setView(key, mockView);

      const retrieved = useReaderStore.getState().getView(key);
      expect(retrieved).toBe(mockView);
    });
  });

  describe('getViews', () => {
    test('returns all views from viewStates', () => {
      const view1 = { id: 'v1' } as unknown as FoliateView;
      const view2 = { id: 'v2' } as unknown as FoliateView;
      seedViewState('key1', { view: view1 });
      seedViewState('key2', { view: view2 });

      const views = useReaderStore.getState().getViews();
      expect(views).toHaveLength(2);
      expect(views).toContain(view1);
      expect(views).toContain(view2);
    });
  });

  describe('clearViewState', () => {
    test('removes a view state by key', () => {
      seedViewState('key-to-remove');
      seedViewState('key-to-keep');

      useReaderStore.getState().clearViewState('key-to-remove');
      const state = useReaderStore.getState();
      expect(state.viewStates['key-to-remove']).toBeUndefined();
      expect(state.viewStates['key-to-keep']).toBeDefined();
    });

    test('does nothing when key does not exist', () => {
      seedViewState('existing');
      useReaderStore.getState().clearViewState('nonexistent');
      expect(useReaderStore.getState().viewStates['existing']).toBeDefined();
    });
  });

  describe('getViewState', () => {
    test('returns null for missing key', () => {
      expect(useReaderStore.getState().getViewState('missing')).toBeNull();
    });

    test('returns the view state for existing key', () => {
      seedViewState('my-key');
      const vs = useReaderStore.getState().getViewState('my-key');
      expect(vs).not.toBeNull();
      expect(vs!.key).toBe('my-key');
    });
  });

  describe('setViewSettings / getViewSettings', () => {
    test('getViewSettings returns null for missing key', () => {
      expect(useReaderStore.getState().getViewSettings('missing')).toBeNull();
    });

    test('setViewSettings stores and getViewSettings retrieves settings', () => {
      const key = 'bookid-0';
      seedViewState(key, { isPrimary: false });

      // setViewSettings requires bookData to exist for the book id
      useBookDataStore.setState({
        booksData: {
          bookid: {
            id: 'bookid',
            book: null,
            file: null,
            config: { updatedAt: Date.now() },
            bookDoc: null,
            isFixedLayout: false,
          },
        },
      });

      const settings = { fontSize: 16 } as unknown as ViewSettings;
      useReaderStore.getState().setViewSettings(key, settings);

      const retrieved = useReaderStore.getState().getViewSettings(key);
      expect(retrieved).toEqual(settings);
    });

    test('setViewSettings does nothing for empty key', () => {
      useReaderStore.getState().setViewSettings('', { fontSize: 16 } as unknown as ViewSettings);
      // Should not throw or create new state
      expect(Object.keys(useReaderStore.getState().viewStates)).toHaveLength(0);
    });
  });

  describe('setBookmarkRibbonVisibility', () => {
    test('sets ribbonVisible on view state', () => {
      seedViewState('book-1');
      useReaderStore.getState().setBookmarkRibbonVisibility('book-1', true);
      expect(useReaderStore.getState().viewStates['book-1']!.ribbonVisible).toBe(true);

      useReaderStore.getState().setBookmarkRibbonVisibility('book-1', false);
      expect(useReaderStore.getState().viewStates['book-1']!.ribbonVisible).toBe(false);
    });
  });

  describe('setTTSEnabled', () => {
    test('sets ttsEnabled on view state', () => {
      seedViewState('book-1');
      useReaderStore.getState().setTTSEnabled('book-1', true);
      expect(useReaderStore.getState().viewStates['book-1']!.ttsEnabled).toBe(true);

      useReaderStore.getState().setTTSEnabled('book-1', false);
      expect(useReaderStore.getState().viewStates['book-1']!.ttsEnabled).toBe(false);
    });
  });

  describe('setIsLoading', () => {
    test('sets loading on view state', () => {
      seedViewState('book-1');
      useReaderStore.getState().setIsLoading('book-1', true);
      expect(useReaderStore.getState().viewStates['book-1']!.loading).toBe(true);

      useReaderStore.getState().setIsLoading('book-1', false);
      expect(useReaderStore.getState().viewStates['book-1']!.loading).toBe(false);
    });
  });

  describe('setIsSyncing', () => {
    test('sets syncing on view state', () => {
      seedViewState('book-1');
      useReaderStore.getState().setIsSyncing('book-1', true);
      expect(useReaderStore.getState().viewStates['book-1']!.syncing).toBe(true);

      useReaderStore.getState().setIsSyncing('book-1', false);
      expect(useReaderStore.getState().viewStates['book-1']!.syncing).toBe(false);
    });
  });

  describe('getGridInsets / setGridInsets', () => {
    test('getGridInsets returns default insets for missing key', () => {
      const insets = useReaderStore.getState().getGridInsets('missing');
      expect(insets).toEqual({ top: 0, right: 0, bottom: 0, left: 0 });
    });

    test('setGridInsets stores and getGridInsets retrieves insets', () => {
      seedViewState('book-1');
      const insets: Insets = { top: 10, right: 5, bottom: 20, left: 5 };
      useReaderStore.getState().setGridInsets('book-1', insets);
      expect(useReaderStore.getState().getGridInsets('book-1')).toEqual(insets);
    });

    test('setGridInsets can set null', () => {
      seedViewState('book-1');
      useReaderStore.getState().setGridInsets('book-1', { top: 1, right: 2, bottom: 3, left: 4 });
      useReaderStore.getState().setGridInsets('book-1', null);
      // getGridInsets falls back to default when gridInsets is null
      expect(useReaderStore.getState().getGridInsets('book-1')).toEqual({
        top: 0,
        right: 0,
        bottom: 0,
        left: 0,
      });
    });
  });

  describe('setViewInited', () => {
    test('sets inited on view state', () => {
      seedViewState('book-1');
      useReaderStore.getState().setViewInited('book-1', true);
      expect(useReaderStore.getState().viewStates['book-1']!.inited).toBe(true);

      useReaderStore.getState().setViewInited('book-1', false);
      expect(useReaderStore.getState().viewStates['book-1']!.inited).toBe(false);
    });
  });

  describe('reading session tracking', () => {
    test('setViewInited starts a session timestamp and start page', () => {
      seedViewState('book-1', { progress: { pageinfo: { current: 12 } } });
      vi.useFakeTimers();
      vi.setSystemTime(new Date('2026-04-11T20:00:00Z'));

      useReaderStore.getState().setViewInited('book-1', true);
      const state = useReaderStore.getState().viewStates['book-1']!;

      expect(state.inited).toBe(true);
      expect(state.sessionStartedAt).toBe(new Date('2026-04-11T20:00:00Z').getTime());
      expect(state.sessionStartPage).toBe(12);
      vi.useRealTimers();
    });

    test('recordSession preserves hyphenated bookHash and clears tracking state', () => {
      vi.useFakeTimers();
      vi.setSystemTime(new Date('2026-04-11T20:30:00Z'));
      seedViewState('book-hash-with-hyphen-0', {
        bookHash: 'book-hash-with-hyphen',
        inited: true,
        sessionStartedAt: new Date('2026-04-11T20:00:00Z').getTime(),
        sessionStartPage: 10,
        progress: { pageinfo: { current: 18 } },
      });

      const recorded = useReaderStore.getState().recordSession('book-hash-with-hyphen-0');

      expect(recorded).toBe(true);
      expect(mockReadingStatsRecordSession).toHaveBeenCalledWith(
        expect.objectContaining({
          bookHash: 'book-hash-with-hyphen',
          secondsRead: 1800,
          pageDelta: 8,
        }),
      );
      expect(mockReadingStatsRecordSession).not.toHaveBeenCalledWith(
        expect.objectContaining({ bookHash: 'book' }),
      );
      expect(
        useReaderStore.getState().viewStates['book-hash-with-hyphen-0']!.sessionStartedAt,
      ).toBeNull();
      expect(
        useReaderStore.getState().viewStates['book-hash-with-hyphen-0']!.sessionStartPage,
      ).toBeNull();
      vi.useRealTimers();
    });

    test('recordSession skips uninited views', () => {
      seedViewState('book-1', { inited: false });

      const recorded = useReaderStore.getState().recordSession('book-1');

      expect(recorded).toBe(false);
      expect(mockReadingStatsRecordSession).not.toHaveBeenCalled();
    });

    test('beforeunload flushes an active session', () => {
      vi.useFakeTimers();
      const startedAt = new Date('2026-04-11T20:00:00Z').getTime();
      vi.setSystemTime(startedAt);
      seedViewState('book-1', {
        bookHash: 'book-1',
        inited: true,
        sessionStartedAt: startedAt,
        sessionStartPage: 10,
        progress: { pageinfo: { current: 14 } },
      });

      vi.setSystemTime(new Date('2026-04-11T20:30:00Z'));
      window.dispatchEvent(new Event('beforeunload'));

      expect(mockReadingStatsRecordSession).toHaveBeenCalledTimes(1);
      expect(mockReadingStatsRecordSession).toHaveBeenCalledWith(
        expect.objectContaining({
          bookHash: 'book-1',
          startedAt,
          endedAt: new Date('2026-04-11T20:30:00Z').getTime(),
          secondsRead: 1800,
          pageDelta: 4,
        }),
      );
      expect(useReaderStore.getState().viewStates['book-1']!.sessionStartedAt).toBeNull();
      expect(useReaderStore.getState().viewStates['book-1']!.sessionStartPage).toBeNull();
      vi.useRealTimers();
    });

    test('visibility loss checkpoints and visibility return resumes tracking', () => {
      vi.useFakeTimers();
      const startedAt = new Date('2026-04-11T20:00:00Z').getTime();
      vi.setSystemTime(startedAt);
      seedViewState('book-1', {
        bookHash: 'book-1',
        inited: true,
        sessionStartedAt: startedAt,
        sessionStartPage: 10,
        view: { tagName: 'FOLIATE-VIEW' } as unknown as FoliateView,
        progress: { pageinfo: { current: 12 } },
      });

      vi.setSystemTime(new Date('2026-04-11T20:30:00Z'));
      setDocumentVisibilityState('hidden');
      document.dispatchEvent(new Event('visibilitychange'));

      expect(mockReadingStatsRecordSession).toHaveBeenCalledTimes(1);
      expect(mockReadingStatsRecordSession).toHaveBeenCalledWith(
        expect.objectContaining({
          bookHash: 'book-1',
          startedAt,
          endedAt: new Date('2026-04-11T20:30:00Z').getTime(),
          secondsRead: 1800,
          pageDelta: 2,
        }),
      );
      expect(useReaderStore.getState().viewStates['book-1']!.sessionStartedAt).toBeNull();
      expect(useReaderStore.getState().viewStates['book-1']!.sessionStartPage).toBeNull();

      vi.setSystemTime(new Date('2026-04-11T20:31:00Z'));
      setDocumentVisibilityState('visible');
      document.dispatchEvent(new Event('visibilitychange'));

      const resumedState = useReaderStore.getState().viewStates['book-1']!;
      expect(resumedState.sessionStartedAt).toBe(new Date('2026-04-11T20:31:00Z').getTime());
      expect(resumedState.sessionStartPage).toBe(12);

      setViewCurrentPage('book-1', 15);
      vi.setSystemTime(new Date('2026-04-11T20:45:00Z'));
      const recorded = useReaderStore.getState().recordSession('book-1');

      expect(recorded).toBe(true);
      expect(mockReadingStatsRecordSession).toHaveBeenCalledTimes(2);
      expect(mockReadingStatsRecordSession).toHaveBeenLastCalledWith(
        expect.objectContaining({
          bookHash: 'book-1',
          startedAt: new Date('2026-04-11T20:31:00Z').getTime(),
          endedAt: new Date('2026-04-11T20:45:00Z').getTime(),
          secondsRead: 840,
          pageDelta: 3,
        }),
      );
      expect(useReaderStore.getState().viewStates['book-1']!.sessionStartedAt).toBeNull();
      expect(useReaderStore.getState().viewStates['book-1']!.sessionStartPage).toBeNull();
      vi.useRealTimers();
    });

    test('sub-second hidden intervals reset the session boundary before resume', () => {
      vi.useFakeTimers();
      try {
        const startedAt = new Date('2026-04-11T20:00:00Z').getTime();
        seedViewState('book-1', {
          bookHash: 'book-1',
          inited: true,
          sessionStartedAt: startedAt,
          sessionStartPage: 10,
          view: { tagName: 'FOLIATE-VIEW' } as unknown as FoliateView,
          progress: { pageinfo: { current: 12 } },
        });

        mockReadingStatsRecordSession.mockReturnValueOnce(false);

        vi.setSystemTime(startedAt + 500);
        setDocumentVisibilityState('hidden');
        document.dispatchEvent(new Event('visibilitychange'));

        expect(mockReadingStatsRecordSession).toHaveBeenCalledTimes(1);
        expect(mockReadingStatsRecordSession).toHaveBeenCalledWith(
          expect.objectContaining({
            bookHash: 'book-1',
            startedAt,
            endedAt: startedAt + 500,
            secondsRead: 0,
            pageDelta: 2,
          }),
        );

        const hiddenState = useReaderStore.getState().viewStates['book-1']!;
        expect(hiddenState.sessionStartedAt).toBeNull();
        expect(hiddenState.sessionStartPage).toBeNull();

        vi.setSystemTime(new Date('2026-04-11T20:05:00Z'));
        setDocumentVisibilityState('visible');
        document.dispatchEvent(new Event('visibilitychange'));

        const resumedState = useReaderStore.getState().viewStates['book-1']!;
        expect(resumedState.sessionStartedAt).toBe(new Date('2026-04-11T20:05:00Z').getTime());
        expect(resumedState.sessionStartPage).toBe(12);

        setViewCurrentPage('book-1', 15);
        vi.setSystemTime(new Date('2026-04-11T20:20:00Z'));
        const recorded = useReaderStore.getState().recordSession('book-1');

        expect(recorded).toBe(true);
        expect(mockReadingStatsRecordSession).toHaveBeenCalledTimes(2);
        expect(mockReadingStatsRecordSession).toHaveBeenLastCalledWith(
          expect.objectContaining({
            bookHash: 'book-1',
            startedAt: new Date('2026-04-11T20:05:00Z').getTime(),
            endedAt: new Date('2026-04-11T20:20:00Z').getTime(),
            secondsRead: 900,
            pageDelta: 3,
          }),
        );
      } finally {
        vi.useRealTimers();
      }
    });
  });

  describe('indexing progress', () => {
    test('tracks run-scoped progress and clears after completion hold', () => {
      vi.useFakeTimers();
      const store = useReaderStore.getState();

      store.startIndexing('book-1', 'run-1');
      expect(useReaderStore.getState().indexingProgress['book-1']).toEqual({
        runId: 'run-1',
        current: 0,
        total: 1,
        phase: 'pending',
      });

      store.updateIndexingProgress('book-1', 'run-1', {
        current: 2,
        total: 4,
        phase: 'embedding',
      });
      expect(useReaderStore.getState().indexingProgress['book-1']).toEqual({
        runId: 'run-1',
        current: 2,
        total: 4,
        phase: 'embedding',
      });

      store.finishIndexing('book-1', 'run-1');
      expect(useReaderStore.getState().indexingProgress['book-1']).toEqual({
        runId: 'run-1',
        current: 4,
        total: 4,
        phase: 'complete',
      });

      vi.advanceTimersByTime(1199);
      expect(useReaderStore.getState().indexingProgress['book-1']).toBeDefined();

      vi.advanceTimersByTime(1);
      expect(useReaderStore.getState().indexingProgress['book-1']).toBeUndefined();
      vi.useRealTimers();
    });

    test('ignores stale run updates and stale cancellations', () => {
      const store = useReaderStore.getState();

      store.startIndexing('book-1', 'run-2');
      store.updateIndexingProgress('book-1', 'run-old', {
        current: 1,
        total: 3,
        phase: 'chunking',
      });

      expect(useReaderStore.getState().indexingProgress['book-1']).toEqual({
        runId: 'run-2',
        current: 0,
        total: 1,
        phase: 'pending',
      });

      store.cancelIndexing('book-1', 'run-old');
      expect(useReaderStore.getState().indexingProgress['book-1']).toBeDefined();

      store.cancelIndexing('book-1', 'run-2');
      expect(useReaderStore.getState().indexingProgress['book-1']).toBeUndefined();
    });
  });
});
