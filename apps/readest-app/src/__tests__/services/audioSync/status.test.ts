import { describe, expect, it } from 'vitest';

import { buildAudioSyncStatus, deriveAudioSyncStage } from '@/services/audioSync/status';
import { AudioSyncGeneratedPackage, AudioSyncMap } from '@/services/audioSync/types';

function makeMap(version: number = 2): AudioSyncMap {
  return {
    id: 'map-1',
    version: version as 2,
    bookHash: 'book-1',
    audioHash: 'audio-1',
    granularity: 'sentence',
    status: 'ready',
    coverage: { matchedChars: 10, totalChars: 10, matchedRatio: 1 },
    confidence: { overall: 0.9, byChapter: {} },
    segments: [],
    createdAt: 1,
    updatedAt: 2,
  };
}

function makePackage(valid: boolean = true): AudioSyncGeneratedPackage {
  return {
    version: 1,
    generator: 'test-generator',
    bookHash: 'book-1',
    audioHash: 'audio-1',
    syncMapId: 'map-1',
    syncMapVersion: 2,
    packagePath: 'book-1/audio/epub3-sync/v1/synced.epub',
    audioPath: 'book-1/audio/normalized.mp3',
    audioFileName: 'asset.mp3',
    sizeBytes: 42,
    createdAt: 1,
    updatedAt: 2,
    validation: {
      valid,
      checkedAt: 2,
      diagnostics: valid
        ? []
        : [{ code: 'invalid-package', message: 'invalid', severity: 'error' }],
    },
  };
}

describe('audio-sync status derivation', () => {
  it('marks mismatched map versions as legacy', () => {
    expect(deriveAudioSyncStage(makeMap(1), null, {})).toBe('legacy');
  });

  it('marks current json sidecars as intermediate until a runtime artifact exists', () => {
    expect(deriveAudioSyncStage(makeMap(), null, {})).toBe('intermediate');
  });

  it('marks validated generated packages as ready', () => {
    expect(deriveAudioSyncStage(makeMap(), makePackage(), {})).toBe('ready');
  });

  it('allows an explicit json fallback to mark current maps ready', () => {
    const status = buildAudioSyncStatus(
      { asset: null, map: makeMap(), job: null, report: null, package: null },
      { allowJsonFallback: true },
    );

    expect(status.syncStage).toBe('ready');
    expect(status.synced).toBe(true);
  });

  it('marks a missing current map plus a legacy sidecar as legacy', () => {
    const status = buildAudioSyncStatus(
      { asset: null, map: null, job: null, report: null, package: null },
      { legacyMapDetected: true },
    );

    expect(status.syncStage).toBe('legacy');
    expect(status.synced).toBe(false);
  });

  it('does not mark invalid generated packages as ready', () => {
    const status = buildAudioSyncStatus(
      { asset: null, map: makeMap(), job: null, report: null, package: makePackage(false) },
      {},
    );

    expect(status.syncStage).toBe('intermediate');
    expect(status.synced).toBe(false);
  });
});
