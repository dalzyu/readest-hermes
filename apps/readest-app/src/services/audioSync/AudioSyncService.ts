import { AppService } from '@/types/system';

import { AudioSyncMap, AudioSyncSegment, AudioSyncWord, BookAudioAsset } from './types';

const AUDIO_MIME_TYPES: Record<BookAudioAsset['format'], string> = {
  m4b: 'audio/mp4',
  m4a: 'audio/mp4',
  mp3: 'audio/mpeg',
};

export interface AudioSyncPlaybackSource {
  src: string;
  revoke?: () => void;
}

export async function createAudioPlaybackSource(
  appService: AppService,
  asset: BookAudioAsset,
): Promise<AudioSyncPlaybackSource> {
  const path = asset.normalizedPath || asset.originalPath;
  const content = await appService.readFile(path, 'Books', 'binary');
  const blob = new Blob([content], {
    type: AUDIO_MIME_TYPES[asset.normalizedFormat || asset.format],
  });
  const src = URL.createObjectURL(blob);
  return {
    src,
    revoke: () => URL.revokeObjectURL(src),
  };
}

function findTimedEntry<T extends { audioStartMs: number; audioEndMs: number }>(
  entries: T[],
  timeMs: number,
): T | null {
  let low = 0;
  let high = entries.length - 1;

  while (low <= high) {
    const mid = Math.floor((low + high) / 2);
    const candidate = entries[mid]!;
    if (timeMs < candidate.audioStartMs) {
      high = mid - 1;
      continue;
    }
    if (timeMs >= candidate.audioEndMs) {
      low = mid + 1;
      continue;
    }
    return candidate;
  }

  return null;
}

export function getSegmentAtTime(map: AudioSyncMap, timeMs: number): AudioSyncSegment | null {
  return findTimedEntry(map.segments, timeMs);
}

export function getWordAtTime(
  segment: AudioSyncSegment | null,
  timeMs: number,
): AudioSyncWord | null {
  return segment?.words?.length ? findTimedEntry(segment.words, timeMs) : null;
}
