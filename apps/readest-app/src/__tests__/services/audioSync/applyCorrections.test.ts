import { describe, expect, it } from 'vitest';
import { applyAudioSyncCorrections } from '@/services/audioSync/corrections';
import {
  AudioSyncCorrectionSidecar,
  AudioSyncMap,
  BookAudioAsset,
} from '@/services/audioSync/types';

function makeMap(overrides: Partial<AudioSyncMap> = {}): AudioSyncMap {
  return {
    id: 'map-1',
    version: 2,
    bookHash: 'book-1',
    audioHash: 'audio-1',
    granularity: 'word',
    status: 'ready',
    coverage: { matchedChars: 100, totalChars: 100, matchedRatio: 1 },
    confidence: { overall: 0.95, byChapter: {} },
    segments: [
      {
        id: 'seg-intro',
        sectionHref: 'intro.xhtml',
        cfiStart: 'cfi-i-start',
        cfiEnd: 'cfi-i-end',
        text: 'Intro text',
        audioStartMs: 0,
        audioEndMs: 5_000,
        confidence: 0.9,
        words: [
          {
            id: 'w1',
            sectionHref: 'intro.xhtml',
            cfiStart: 'cfi-w1-s',
            cfiEnd: 'cfi-w1-e',
            text: 'Intro',
            audioStartMs: 0,
            audioEndMs: 2_000,
            confidence: 0.9,
          },
        ],
      },
      {
        id: 'seg-ch1',
        sectionHref: 'chapter1.xhtml',
        cfiStart: 'cfi-c1-start',
        cfiEnd: 'cfi-c1-end',
        text: 'Chapter one text',
        audioStartMs: 60_000,
        audioEndMs: 120_000,
        confidence: 0.95,
        words: [
          {
            id: 'w2',
            sectionHref: 'chapter1.xhtml',
            cfiStart: 'cfi-w2-s',
            cfiEnd: 'cfi-w2-e',
            text: 'Chapter',
            audioStartMs: 60_000,
            audioEndMs: 63_000,
            confidence: 0.95,
          },
        ],
      },
    ],
    createdAt: 1,
    updatedAt: 1,
    ...overrides,
  };
}

function makeAsset(): BookAudioAsset {
  return {
    id: 'asset-1',
    bookHash: 'book-1',
    audioHash: 'audio-1',
    originalPath: 'book-1/audio/source.m4b',
    originalFilename: 'source.m4b',
    format: 'm4b',
    durationMs: 200_000,
    chapters: [
      { index: 0, title: 'Intro', startMs: 0, endMs: 60_000 },
      { index: 1, title: 'Chapter 1', startMs: 60_000, endMs: 120_000 },
    ],
    createdAt: 1,
    updatedAt: 2,
  };
}

function makeSidecar(
  overrides: Partial<AudioSyncCorrectionSidecar> = {},
): AudioSyncCorrectionSidecar {
  return {
    bookHash: 'book-1',
    audioHash: 'audio-1',
    corrections: [],
    createdAt: 1,
    updatedAt: 2,
    ...overrides,
  };
}

describe('applyAudioSyncCorrections', () => {
  it('returns the original map when there are no corrections', () => {
    const map = makeMap();
    const result = applyAudioSyncCorrections(map, makeSidecar(), makeAsset());
    expect(result).toBe(map);
  });

  it('throws when bookHash or audioHash does not match', () => {
    const sidecar = makeSidecar({ audioHash: 'wrong-audio' });
    expect(() => applyAudioSyncCorrections(makeMap(), sidecar, makeAsset())).toThrow();
  });

  it('shifts audio timestamps for a corrected chapter', () => {
    const sidecar = makeSidecar({
      corrections: [{ audioChapterIndex: 1, audioOffsetMs: 2_000 }],
    });
    const result = applyAudioSyncCorrections(makeMap(), sidecar, makeAsset());
    const seg = result.segments.find((s) => s.id === 'seg-ch1')!;
    expect(seg.audioStartMs).toBe(62_000);
    expect(seg.audioEndMs).toBe(122_000);
    expect(seg.words![0]!.audioStartMs).toBe(62_000);
    expect(seg.words![0]!.audioEndMs).toBe(65_000);
  });

  it('does not shift untouched chapters', () => {
    const sidecar = makeSidecar({
      corrections: [{ audioChapterIndex: 1, audioOffsetMs: 1_000 }],
    });
    const result = applyAudioSyncCorrections(makeMap(), sidecar, makeAsset());
    const intro = result.segments.find((s) => s.id === 'seg-intro')!;
    expect(intro.audioStartMs).toBe(0);
  });

  it('degrades a nonBookAudio chapter to zero-confidence with no words', () => {
    const sidecar = makeSidecar({
      corrections: [{ audioChapterIndex: 0, nonBookAudio: true }],
    });
    const result = applyAudioSyncCorrections(makeMap(), sidecar, makeAsset());
    const intro = result.segments.find((s) => s.id === 'seg-intro')!;
    expect(intro.confidence).toBe(0);
    expect(intro.words).toHaveLength(0);
  });

  it('remaps sectionHref when sectionIndexOverride is provided', () => {
    const sidecar = makeSidecar({
      corrections: [{ audioChapterIndex: 1, sectionIndexOverride: 2 }],
    });
    const sectionMap = new Map([[2, 'chapter2.xhtml']]);
    const result = applyAudioSyncCorrections(makeMap(), sidecar, makeAsset(), sectionMap);
    const seg = result.segments.find((s) => s.id === 'seg-ch1')!;
    expect(seg.sectionHref).toBe('chapter2.xhtml');
    expect(seg.cfiStart).toBe('');
    expect(seg.cfiEnd).toBe('');
  });

  it('clamps negative timestamps to zero', () => {
    const sidecar = makeSidecar({
      corrections: [{ audioChapterIndex: 0, audioOffsetMs: -99_999 }],
    });
    const result = applyAudioSyncCorrections(makeMap(), sidecar, makeAsset());
    const intro = result.segments.find((s) => s.id === 'seg-intro')!;
    expect(intro.audioStartMs).toBe(0);
    expect(intro.audioEndMs).toBe(0);
  });
});
