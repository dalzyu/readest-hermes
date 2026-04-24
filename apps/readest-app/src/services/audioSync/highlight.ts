import type { BookNote } from '@/types/book';

import type { AudioSyncMap, AudioSyncWord } from './types';

export const AUDIO_SYNC_WORD_HIGHLIGHT_PREFIX = 'audio-sync-word-highlight:';

export function findAudioSyncWord(
  map: AudioSyncMap | null | undefined,
  activeWordId: string | null | undefined,
): AudioSyncWord | null {
  if (!map || !activeWordId) {
    return null;
  }

  for (const segment of map.segments) {
    const word = segment.words?.find((candidate) => candidate.id === activeWordId);
    if (word) {
      return word;
    }
  }

  return null;
}

export function createAudioSyncWordHighlightNote(
  word: AudioSyncWord,
  cfi: string,
  color: string,
  timestamp = Date.now(),
): BookNote {
  return {
    id: `${AUDIO_SYNC_WORD_HIGHLIGHT_PREFIX}${word.id}`,
    type: 'annotation',
    cfi,
    text: word.text,
    style: 'underline',
    color,
    note: '',
    createdAt: timestamp,
    updatedAt: timestamp,
  };
}
