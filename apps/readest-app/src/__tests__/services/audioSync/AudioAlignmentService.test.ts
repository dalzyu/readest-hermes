import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('@/services/audioSync/EpubMediaOverlayService', () => ({
  generateEpubMediaOverlayPackage: vi.fn(),
}));

import { Book } from '@/types/book';
import { AppService } from '@/types/system';
import { useAudioSyncStore } from '@/store/audioSyncStore';
import {
  cancelAudioAlignment,
  ensureAudioSyncPackage,
  pollAudioAlignmentStatus,
  startAudioAlignment,
} from '@/services/audioSync/AudioAlignmentService';
import { useAlignmentJobStore } from '@/services/audioSync/alignmentJobStore';
import { generateEpubMediaOverlayPackage } from '@/services/audioSync/EpubMediaOverlayService';
import {
  AudioSyncGeneratedPackage,
  AudioSyncJobStatus,
  AudioSyncMap,
  AudioSyncStatus,
  BookAudioAsset,
} from '@/services/audioSync/types';

function makeBook(overrides: Partial<Book> = {}): Book {
  return {
    hash: 'book-1',
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
    bookHash: 'book-1',
    audioHash: 'audio-1',
    originalPath: 'book-1/audio/source.mp3',
    originalFilename: 'source.mp3',
    format: 'mp3',
    createdAt: 1,
    updatedAt: 2,
  };
}

function makeMap(): AudioSyncMap {
  return {
    id: 'map-1',
    version: 2,
    bookHash: 'book-1',
    audioHash: 'audio-1',
    granularity: 'word',
    status: 'ready',
    coverage: { matchedChars: 10, totalChars: 10, matchedRatio: 1 },
    confidence: { overall: 1, byChapter: { chapter1: 1 } },
    segments: [],
    createdAt: 1,
    updatedAt: 2,
  };
}

function makePackage(): AudioSyncGeneratedPackage {
  return {
    version: 1,
    generator: 'test-generator',
    bookHash: 'book-1',
    audioHash: 'audio-1',
    syncMapId: 'map-1',
    syncMapVersion: 2,
    packagePath: 'book-1/audio/epub3-sync/v1/synced.epub',
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

function makeStatus(job: AudioSyncJobStatus): AudioSyncStatus {
  return {
    asset: makeAsset(),
    map: null,
    job,
    report: null,
    playable: true,
    synced: false,
    chapterFallback: false,
    syncStage: 'none',
  };
}

describe('AudioAlignmentService', () => {
  const book = makeBook();
  let appService: Pick<AppService, 'startAudioSync' | 'getAudioSyncStatus' | 'cancelAudioSync'>;

  beforeEach(() => {
    useAudioSyncStore.setState({ sessionStates: {}, statuses: {} });
    useAlignmentJobStore.setState({ activeRuns: {}, polling: {} });

    appService = {
      startAudioSync: vi.fn().mockResolvedValue({
        runId: 'run-1',
        phase: 'pending',
        progress: 0,
        updatedAt: 1,
      }),
      getAudioSyncStatus: vi
        .fn()
        .mockResolvedValue(
          makeStatus({ runId: 'run-1', phase: 'aligning', progress: 50, updatedAt: 2 }),
        ),
      cancelAudioSync: vi.fn().mockResolvedValue(undefined),
    };
  });

  it('starts alignment and stores the active run', async () => {
    const status = await startAudioAlignment(appService as AppService, book);

    expect(appService.startAudioSync).toHaveBeenCalledWith(book, undefined);
    expect(appService.getAudioSyncStatus).toHaveBeenCalledWith(book, 'run-1');
    expect(status.job?.phase).toBe('aligning');
    expect(useAlignmentJobStore.getState().activeRuns[book.hash]).toBe('run-1');
    expect(useAudioSyncStore.getState().statuses[book.hash]?.job?.runId).toBe('run-1');
  });

  it('clears the active run when polling reaches a terminal phase', async () => {
    useAlignmentJobStore.getState().setActiveRun(book.hash, 'run-1');
    (appService.getAudioSyncStatus as ReturnType<typeof vi.fn>).mockResolvedValueOnce(
      makeStatus({ runId: 'run-1', phase: 'ready', progress: 100, updatedAt: 3 }),
    );

    const status = await pollAudioAlignmentStatus(appService as AppService, book, 'run-1');

    expect(status.job?.phase).toBe('ready');
    expect(useAlignmentJobStore.getState().activeRuns[book.hash]).toBeUndefined();
  });

  it('generates the EPUB3 package and refreshes status when alignment reaches ready without one', async () => {
    const intermediateStatus: AudioSyncStatus = {
      ...makeStatus({ runId: 'run-1', phase: 'ready', progress: 100, updatedAt: 3 }),
      map: makeMap(),
      syncStage: 'intermediate',
    };
    const readyStatus: AudioSyncStatus = {
      ...intermediateStatus,
      package: makePackage(),
      synced: true,
      syncStage: 'ready',
    };
    (appService.getAudioSyncStatus as ReturnType<typeof vi.fn>)
      .mockResolvedValueOnce(intermediateStatus)
      .mockResolvedValueOnce(readyStatus);
    (generateEpubMediaOverlayPackage as ReturnType<typeof vi.fn>).mockResolvedValue(
      readyStatus.package,
    );

    const status = await pollAudioAlignmentStatus(appService as AppService, book, 'run-1');

    expect(generateEpubMediaOverlayPackage).toHaveBeenCalledWith(
      appService,
      book,
      intermediateStatus.asset,
      intermediateStatus.map,
      intermediateStatus.report,
    );
    expect(appService.getAudioSyncStatus).toHaveBeenNthCalledWith(2, book, 'run-1');
    expect(status.package).toEqual(readyStatus.package);
    expect(useAudioSyncStore.getState().statuses[book.hash]?.package).toEqual(readyStatus.package);
    expect(useAudioSyncStore.getState().statuses[book.hash]?.syncStage).toBe('ready');
  });

  it('surfaces package generation failures even when there is no active job object', async () => {
    const statusWithoutJob: AudioSyncStatus = {
      asset: makeAsset(),
      map: makeMap(),
      job: null,
      report: null,
      package: null,
      playable: true,
      synced: false,
      chapterFallback: false,
      syncStage: 'intermediate',
    };
    (generateEpubMediaOverlayPackage as ReturnType<typeof vi.fn>).mockRejectedValueOnce(
      new Error('package failed'),
    );

    const status = await ensureAudioSyncPackage(appService as AppService, book, statusWithoutJob);

    expect(status.job?.phase).toBe('failed');
    expect(status.job?.error).toBe('package failed');
    expect(status.report?.errors).toContain('package failed');
  });

  it('cancels the active alignment run and updates the store', async () => {
    useAlignmentJobStore.getState().setActiveRun(book.hash, 'run-1');

    await cancelAudioAlignment(appService as AppService, book);

    expect(appService.cancelAudioSync).toHaveBeenCalledWith(book, 'run-1');
    expect(useAlignmentJobStore.getState().activeRuns[book.hash]).toBeUndefined();
    expect(useAudioSyncStore.getState().statuses[book.hash]?.job?.phase).toBe('cancelled');
  });
});
