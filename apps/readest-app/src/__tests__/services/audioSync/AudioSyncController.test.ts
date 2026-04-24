import { describe, expect, it, vi } from 'vitest';

import { AudioSyncController } from '@/services/audioSync/AudioSyncController';
import { AudioSyncMap, AudioSyncSegment, BookAudioAsset } from '@/services/audioSync/types';
import { FoliateView } from '@/types/view';

class FakeAudioElement extends EventTarget {
  currentTime = 0;
  duration = 120;
  playbackRate = 1;
  paused = true;
  preload = '';
  src = '';

  async play() {
    this.paused = false;
    this.dispatchEvent(new Event('play'));
  }

  pause() {
    this.paused = true;
    this.dispatchEvent(new Event('pause'));
  }
}

class FakeMediaOverlay extends EventTarget {
  rate = 1;
  started: Array<number> = [];
  paused = false;

  async start(
    sectionIndex: number,
    filter?: (item: { text: string; begin: number; end: number }) => boolean,
  ) {
    this.started.push(sectionIndex);
    this.paused = false;
    const item = [
      { text: 'chapter-1.xhtml#as-0', begin: 0, end: 5 },
      { text: 'chapter-2.xhtml#as-1', begin: 7, end: 10 },
    ].find((candidate) => (filter ? filter(candidate) : true));
    if (item) {
      this.dispatchEvent(new CustomEvent('highlight', { detail: item }));
    }
  }

  pause() {
    this.paused = true;
  }

  resume() {
    this.paused = false;
  }

  stop() {
    this.paused = true;
  }

  setRate(rate: number) {
    this.rate = rate;
  }
}

function makeAsset(): BookAudioAsset {
  return {
    id: 'asset-1',
    bookHash: 'book-1',
    audioHash: 'audio-1',
    originalPath: 'book-1/audio/source.mp3',
    originalFilename: 'source.mp3',
    format: 'mp3',
    durationMs: 120_000,
    createdAt: 1,
    updatedAt: 2,
  };
}

function makeSegment(overrides: Partial<AudioSyncSegment> = {}): AudioSyncSegment {
  return {
    id: 'seg-1',
    sectionHref: 'chapter-1.xhtml',
    cfiStart: 'epubcfi(/6/2!/4/2/1:0)',
    cfiEnd: 'epubcfi(/6/2!/4/2/1:10)',
    text: 'Alpha',
    audioStartMs: 0,
    audioEndMs: 5_000,
    confidence: 1,
    ...overrides,
  };
}

function makeMap(): AudioSyncMap {
  return {
    id: 'map-1',
    version: 2,
    bookHash: 'book-1',
    audioHash: 'audio-1',
    granularity: 'sentence',
    status: 'ready',
    coverage: { matchedChars: 10, totalChars: 10, matchedRatio: 1 },
    confidence: { overall: 0.9, byChapter: {} },
    segments: [
      makeSegment(),
      makeSegment({
        id: 'seg-2',
        cfiStart: 'epubcfi(/6/4!/4/2/1:0)',
        cfiEnd: 'epubcfi(/6/4!/4/2/1:8)',
        text: 'Beta',
        audioStartMs: 5_000,
        audioEndMs: 10_000,
        words: [
          {
            id: 'word-1',
            sectionHref: 'chapter-2.xhtml',
            cfiStart: 'epubcfi(/6/4!/4/2/1:0)',
            cfiEnd: 'epubcfi(/6/4!/4/2/1:3)',
            text: 'Be',
            audioStartMs: 5_000,
            audioEndMs: 7_000,
            confidence: 1,
          },
          {
            id: 'word-2',
            sectionHref: 'chapter-2.xhtml',
            cfiStart: 'epubcfi(/6/4!/4/2/1:4)',
            cfiEnd: 'epubcfi(/6/4!/4/2/1:8)',
            text: 'ta',
            audioStartMs: 7_000,
            audioEndMs: 10_000,
            confidence: 1,
          },
        ],
      }),
    ],
    createdAt: 1,
    updatedAt: 2,
  };
}

function makeView(mediaOverlay: FakeMediaOverlay): FoliateView {
  return {
    startMediaOverlay: vi.fn(async () => {
      await mediaOverlay.start(0);
    }),
    mediaOverlay,
    resolveNavigation: (target) => ({
      index: typeof target === 'string' && target.includes('/6/4!') ? 1 : 0,
    }),
  } as unknown as FoliateView;
}

describe('AudioSyncController', () => {
  it('tracks active segment changes from playback time', () => {
    const audio = new FakeAudioElement() as unknown as HTMLAudioElement;
    const controller = new AudioSyncController({
      asset: makeAsset(),
      map: makeMap(),
      src: 'blob:test',
      audio,
    });

    const seen: Array<string | null> = [];
    controller.addEventListener('segmentchange', (event) => {
      seen.push((event as CustomEvent<AudioSyncSegment | null>).detail?.id ?? null);
    });

    audio.currentTime = 2;
    audio.dispatchEvent(new Event('timeupdate'));
    audio.currentTime = 7;
    audio.dispatchEvent(new Event('timeupdate'));

    expect(seen).toEqual(['seg-1', 'seg-2']);
    expect(controller.getActiveSegment()?.id).toBe('seg-2');
  });

  it('seeks to the mapped segment when given a cfi without word timings', () => {
    const audio = new FakeAudioElement() as unknown as HTMLAudioElement;
    const controller = new AudioSyncController({
      asset: makeAsset(),
      map: makeMap(),
      src: 'blob:test',
      audio,
    });

    const found = controller.seekToCfi('epubcfi(/6/2!/4/2/1:6)');

    expect(found).toBe(true);
    expect(audio.currentTime).toBe(0);
    expect(controller.getSnapshot().activeSegmentId).toBe('seg-1');
  });

  it('seeks to the mapped word when given a cfi inside a timed word range', () => {
    const audio = new FakeAudioElement() as unknown as HTMLAudioElement;
    const controller = new AudioSyncController({
      asset: makeAsset(),
      map: makeMap(),
      src: 'blob:test',
      audio,
    });

    const found = controller.seekToCfi('epubcfi(/6/4!/4/2/1:5)');

    expect(found).toBe(true);
    expect(audio.currentTime).toBe(7);
    expect(controller.getSnapshot().activeWordId).toBe('word-2');
  });

  it('updates playback rate and emits state changes on play', async () => {
    const audio = new FakeAudioElement() as unknown as HTMLAudioElement;
    const controller = new AudioSyncController({
      asset: makeAsset(),
      map: makeMap(),
      src: 'blob:test',
      audio,
    });

    let latestMode = controller.getSnapshot().mode;
    controller.addEventListener('statechange', (event) => {
      latestMode = (event as CustomEvent<{ mode: string }>).detail.mode as typeof latestMode;
    });

    controller.setRate(1.5);
    await controller.play();

    expect(audio.playbackRate).toBe(1.5);
    expect(latestMode).toBe('playing');
  });

  it('delegates playback to foliate media overlays when a generated package-backed view is attached', async () => {
    const audio = new FakeAudioElement() as unknown as HTMLAudioElement;
    const mediaOverlay = new FakeMediaOverlay();
    const view = makeView(mediaOverlay);
    const controller = new AudioSyncController({
      asset: makeAsset(),
      map: makeMap(),
      src: 'blob:test',
      audio,
      view,
    });

    controller.setRate(1.25);
    await controller.play();

    expect(mediaOverlay.rate).toBe(1.25);
    expect(view.startMediaOverlay as ReturnType<typeof vi.fn>).toHaveBeenCalledTimes(1);
    expect(audio.paused).toBe(true);
    expect(controller.getSnapshot().mode).toBe('playing');

    controller.seekToMs(7_500);
    expect(mediaOverlay.started.at(-1)).toBe(1);
    expect(controller.getSnapshot().activeSegmentId).toBe('seg-2');
    expect(controller.getActiveSegment()?.id).toBe('seg-2');

    controller.pause();
    expect(mediaOverlay.paused).toBe(true);
    expect(controller.getSnapshot().mode).toBe('paused');

    controller.dispose();
    expect(mediaOverlay.paused).toBe(true);
  });
});
