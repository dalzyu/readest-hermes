import { describe, expect, it } from 'vitest';

import {
  AUDIO_SYNC_WORD_HIGHLIGHT_PREFIX,
  createAudioSyncWordHighlightNote,
  findAudioSyncWord,
} from '@/services/audioSync/highlight';
import type { AudioSyncMap, AudioSyncWord } from '@/services/audioSync/types';

function makeWord(overrides: Partial<AudioSyncWord> = {}): AudioSyncWord {
  return {
    id: 'word-1',
    sectionHref: 'chapter.xhtml',
    cfiStart: 'epubcfi(/6/2!/4/2/1:0)',
    cfiEnd: 'epubcfi(/6/2!/4/2/1:5)',
    text: 'Alpha',
    audioStartMs: 1_000,
    audioEndMs: 1_500,
    confidence: 0.95,
    ...overrides,
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
    confidence: { overall: 0.9, byChapter: {} },
    segments: [
      {
        id: 'seg-1',
        sectionHref: 'chapter.xhtml',
        cfiStart: 'epubcfi(/6/2!/4/2/1:0)',
        cfiEnd: 'epubcfi(/6/2!/4/2/1:10)',
        text: 'Alpha Beta',
        audioStartMs: 1_000,
        audioEndMs: 2_000,
        confidence: 0.9,
        words: [makeWord(), makeWord({ id: 'word-2', text: 'Beta' })],
      },
    ],
    createdAt: 1,
    updatedAt: 2,
  };
}

describe('audio-sync highlight helpers', () => {
  it('finds the active word by id across map segments', () => {
    expect(findAudioSyncWord(makeMap(), 'word-2')?.text).toBe('Beta');
    expect(findAudioSyncWord(makeMap(), 'missing')).toBeNull();
    expect(findAudioSyncWord(null, 'word-1')).toBeNull();
    expect(findAudioSyncWord(makeMap(), null)).toBeNull();
  });

  it('creates a temporary non-persistent annotation for the active word', () => {
    const note = createAudioSyncWordHighlightNote(
      makeWord(),
      'epubcfi(/6/2!/4/2/1:0,/1:0,/1:5)',
      '#3366ff',
      123,
    );

    expect(note).toMatchObject({
      id: `${AUDIO_SYNC_WORD_HIGHLIGHT_PREFIX}word-1`,
      type: 'annotation',
      cfi: 'epubcfi(/6/2!/4/2/1:0,/1:0,/1:5)',
      text: 'Alpha',
      style: 'underline',
      color: '#3366ff',
      note: '',
      createdAt: 123,
      updatedAt: 123,
    });
  });
});
