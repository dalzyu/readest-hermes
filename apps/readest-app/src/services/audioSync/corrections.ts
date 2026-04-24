import { AudioSyncCorrectionSidecar, AudioSyncMap, BookAudioAsset } from './types';

/**
 * Applies manual corrections from a sidecar to an existing sync map.
 *
 * Supported corrections per chapter:
 * - `audioOffsetMs`: shifts all audio timestamps in the chapter by the given amount.
 * - `nonBookAudio`: zeroes confidence and removes word-level entries so the chapter
 *   degrades to chapter-level fallback in the generated EPUB3 package.
 * - `sectionIndexOverride`: remaps segments in the chapter to a different section href
 *   using the provided `sectionHrefByIndex` mapping (loaded from alignment input).
 *
 * Returns a new map; the original is not mutated.
 */
export function applyAudioSyncCorrections(
  map: AudioSyncMap,
  sidecar: AudioSyncCorrectionSidecar,
  asset: BookAudioAsset,
  sectionHrefByIndex?: Map<number, string>,
): AudioSyncMap {
  if (map.bookHash !== sidecar.bookHash || map.audioHash !== sidecar.audioHash) {
    throw new Error('Correction sidecar bookHash/audioHash does not match sync map');
  }

  const byChapter = new Map(sidecar.corrections.map((c) => [c.audioChapterIndex, c]));

  if (byChapter.size === 0) {
    return map;
  }

  const chapters = asset.chapters ?? [];

  const correctedSegments = map.segments.map((segment) => {
    const chapter = chapters.find(
      (ch) =>
        segment.audioStartMs >= ch.startMs && (ch.endMs == null || segment.audioStartMs < ch.endMs),
    );
    if (!chapter) return segment;

    const correction = byChapter.get(chapter.index);
    if (!correction) return segment;

    const offsetMs = correction.audioOffsetMs ?? 0;

    if (correction.nonBookAudio) {
      return {
        ...segment,
        audioStartMs: Math.max(0, segment.audioStartMs + offsetMs),
        audioEndMs: Math.max(0, segment.audioEndMs + offsetMs),
        confidence: 0,
        words: [],
      };
    }

    const words = (segment.words ?? []).map((word) => ({
      ...word,
      audioStartMs: Math.max(0, word.audioStartMs + offsetMs),
      audioEndMs: Math.max(0, word.audioEndMs + offsetMs),
    }));

    let sectionHref = segment.sectionHref;
    if (correction.sectionIndexOverride != null && sectionHrefByIndex != null) {
      sectionHref = sectionHrefByIndex.get(correction.sectionIndexOverride) ?? sectionHref;
    }

    const sectionHrefChanged = sectionHref !== segment.sectionHref;
    return {
      ...segment,
      sectionHref,
      // Clear CFIs when remapping sections: they belong to the original DOM and cannot be reused.
      cfiStart: sectionHrefChanged ? '' : segment.cfiStart,
      cfiEnd: sectionHrefChanged ? '' : segment.cfiEnd,
      audioStartMs: Math.max(0, segment.audioStartMs + offsetMs),
      audioEndMs: Math.max(0, segment.audioEndMs + offsetMs),
      words,
    };
  });

  return {
    ...map,
    segments: correctedSegments,
    updatedAt: Date.now(),
  };
}
