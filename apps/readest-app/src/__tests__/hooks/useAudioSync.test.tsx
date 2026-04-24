import { act, cleanup, renderHook, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import type {
  AudioSyncGeneratedPackage,
  AudioSyncMap,
  AudioSyncStatus,
  BookAudioAsset,
} from '@/services/audioSync/types';
import type { Book } from '@/types/book';

const {
  controllerInstances,
  mockCreateAudioPlaybackSource,
  mockEnsureAudioSyncPackage,
  mockGetAudioSyncStatus,
  mockGetBookData,
  mockGetStatus,
  mockGetView,
  mockRecreateViewer,
  mockSetPlaybackError,
  mockSetSessionState,
  mockSetStoredStatus,
  mockUseAudioSyncStore,
  mockUseBookDataStore,
  mockUseEnv,
  mockUseReaderStore,
  MockAudioSyncController,
} = vi.hoisted(() => {
  const controllerInstances: MockAudioSyncController[] = [];
  const mockCreateAudioPlaybackSource = vi.fn();
  const mockEnsureAudioSyncPackage = vi.fn();
  const mockGetAudioSyncStatus = vi.fn();
  const mockGetBookData = vi.fn();
  const mockGetStatus = vi.fn();
  const mockGetView = vi.fn();
  const mockRecreateViewer = vi.fn();
  const mockSetPlaybackError = vi.fn();
  const mockSetSessionState = vi.fn();
  const mockSetStoredStatus = vi.fn();
  const mockUseAudioSyncStore = vi.fn();
  const mockUseBookDataStore = vi.fn();
  const mockUseEnv = vi.fn();
  const mockUseReaderStore = vi.fn();

  class MockAudioSyncController extends EventTarget {
    asset: BookAudioAsset;
    map: AudioSyncMap | null;
    dispose = vi.fn();
    setView = vi.fn();
    seekToCfi = vi.fn();

    constructor(options: { asset: BookAudioAsset; map: AudioSyncMap | null }) {
      super();
      this.asset = options.asset;
      this.map = options.map;
      controllerInstances.push(this);
    }

    getSnapshot() {
      return {
        mode: 'idle' as const,
        currentTimeMs: 0,
        durationMs: 0,
        playbackRate: 1,
        activeSegmentId: null,
        activeWordId: null,
        followMode: 'audio' as const,
      };
    }
  }

  return {
    controllerInstances,
    mockCreateAudioPlaybackSource,
    mockEnsureAudioSyncPackage,
    mockGetAudioSyncStatus,
    mockGetBookData,
    mockGetStatus,
    mockGetView,
    mockRecreateViewer,
    mockSetPlaybackError,
    mockSetSessionState,
    mockSetStoredStatus,
    mockUseAudioSyncStore,
    mockUseBookDataStore,
    mockUseEnv,
    mockUseReaderStore,
    MockAudioSyncController,
  };
});

vi.mock('@/context/EnvContext', () => ({
  useEnv: () => mockUseEnv(),
}));

vi.mock('@/store/bookDataStore', () => ({
  useBookDataStore: () => mockUseBookDataStore(),
}));

vi.mock('@/store/audioSyncStore', () => ({
  useAudioSyncStore: () => mockUseAudioSyncStore(),
}));

vi.mock('@/store/readerStore', () => ({
  useReaderStore: (selector?: (state: unknown) => unknown) => mockUseReaderStore(selector),
}));

vi.mock('@/services/audioSync/AudioSyncService', () => ({
  createAudioPlaybackSource: (...args: unknown[]) => mockCreateAudioPlaybackSource(...args),
}));

vi.mock('@/services/audioSync/AudioAlignmentService', () => ({
  ensureAudioSyncPackage: (...args: unknown[]) => mockEnsureAudioSyncPackage(...args),
}));

vi.mock('@/services/audioSync/AudioSyncController', () => ({
  AudioSyncController: MockAudioSyncController,
}));

import { useAudioSync } from '@/hooks/useAudioSync';

function makeBook(overrides: Partial<Book> = {}): Book {
  return {
    hash: 'book1',
    format: 'EPUB',
    title: 'Example Book',
    author: 'Author',
    createdAt: 1,
    updatedAt: 2,
    ...overrides,
  };
}

function makeAsset(): BookAudioAsset {
  return {
    id: 'asset-1',
    bookHash: 'book1',
    audioHash: 'audio-1',
    originalPath: 'book1/audio/source.mp3',
    originalFilename: 'source.mp3',
    format: 'mp3',
    createdAt: 1,
    updatedAt: 2,
  };
}

function makeMap(id: string): AudioSyncMap {
  return {
    id,
    version: 2,
    bookHash: 'book1',
    audioHash: 'audio-1',
    granularity: 'sentence',
    status: 'ready',
    coverage: { matchedChars: 10, totalChars: 10, matchedRatio: 1 },
    confidence: { overall: 1, byChapter: {} },
    segments: [],
    createdAt: 1,
    updatedAt: 2,
  };
}

function makePackage(syncMapId: string): AudioSyncGeneratedPackage {
  return {
    version: 1,
    generator: 'test-generator',
    bookHash: 'book1',
    audioHash: 'audio-1',
    syncMapId,
    syncMapVersion: 2,
    packagePath: 'book1/audio/epub3-sync/v1/synced.epub',
    audioPath: 'OEBPS/audio/asset.mp3',
    audioFileName: 'asset.mp3',
    sizeBytes: 100,
    createdAt: 1,
    updatedAt: 2,
    validation: {
      valid: true,
      checkedAt: 2,
      diagnostics: [],
    },
  };
}

function makeStatus(
  mapId: string,
  generatedPackage: AudioSyncGeneratedPackage | null,
): AudioSyncStatus {
  return {
    asset: makeAsset(),
    map: makeMap(mapId),
    job: null,
    report: null,
    package: generatedPackage,
    playable: true,
    synced: Boolean(generatedPackage),
    chapterFallback: false,
    syncStage: generatedPackage ? 'ready' : 'intermediate',
  };
}

describe('useAudioSync', () => {
  const bookKey = 'book1-tab';
  const book = makeBook();
  const envConfig = { name: 'env-config' };
  const initialStatus = makeStatus('map-1', null);
  const packageReadyStatus = makeStatus('map-2', makePackage('map-2'));

  beforeEach(() => {
    vi.clearAllMocks();
    controllerInstances.length = 0;

    const readerStoreState = {
      getView: mockGetView,
      recreateViewer: mockRecreateViewer,
      viewStates: {
        [bookKey]: {
          view: { goTo: vi.fn() },
        },
      },
    };

    mockUseEnv.mockReturnValue({
      envConfig,
      appService: {
        isDesktopApp: true,
        getAudioSyncStatus: mockGetAudioSyncStatus,
      },
    });
    mockUseBookDataStore.mockReturnValue({
      getBookData: mockGetBookData,
    });
    mockUseAudioSyncStore.mockReturnValue({
      getStatus: mockGetStatus,
      setPlaybackError: mockSetPlaybackError,
      setSessionState: mockSetSessionState,
      setStatus: mockSetStoredStatus,
    });
    mockUseReaderStore.mockImplementation(
      (selector?: (state: typeof readerStoreState) => unknown) =>
        selector ? selector(readerStoreState) : readerStoreState,
    );

    mockGetView.mockReturnValue({ goTo: vi.fn() });
    mockGetStatus.mockReturnValue({
      asset: null,
      map: null,
      job: null,
      report: null,
      package: null,
      playable: false,
      synced: false,
      chapterFallback: false,
      syncStage: 'none',
    });
    mockGetBookData.mockReturnValue({
      book,
      file: new File(['original'], 'Original.epub', { type: 'application/epub+zip' }),
    });
    mockCreateAudioPlaybackSource.mockResolvedValue({ src: 'blob:test', revoke: vi.fn() });
    mockGetAudioSyncStatus
      .mockResolvedValueOnce(initialStatus)
      .mockResolvedValueOnce(initialStatus);
    mockEnsureAudioSyncPackage
      .mockResolvedValueOnce(initialStatus)
      .mockResolvedValueOnce(packageReadyStatus);
  });

  afterEach(() => {
    cleanup();
  });

  it('recreates the controller and reloads the viewer when a package becomes ready under the same asset', async () => {
    const { result } = renderHook(() => useAudioSync(bookKey));

    await waitFor(() => {
      expect(controllerInstances).toHaveLength(1);
    });

    await act(async () => {
      await result.current.reload('run-2');
    });

    await waitFor(() => {
      expect(controllerInstances).toHaveLength(2);
    });

    expect(controllerInstances[0]?.dispose).toHaveBeenCalledTimes(1);
    expect(mockRecreateViewer).toHaveBeenCalledWith(envConfig, bookKey);
    expect(mockSetStoredStatus).toHaveBeenLastCalledWith(book.hash, packageReadyStatus);
    expect(mockCreateAudioPlaybackSource).toHaveBeenCalledTimes(2);
    expect(mockSetPlaybackError).not.toHaveBeenCalled();
  });
});
