import { AUDIO_SYNC_MAP_VERSION } from './constants';
import {
  AudioAlignmentReport,
  AudioSyncCorrectionSidecar,
  AudioSyncGeneratedPackage,
  AudioSyncJobStatus,
  AudioSyncMap,
  AudioSyncStage,
  AudioSyncStatus,
  BookAudioAsset,
} from './types';

export interface DeriveAudioSyncStatusOptions {
  allowJsonFallback?: boolean;
  legacyMapDetected?: boolean;
  runtimeReady?: boolean;
}

export function deriveAudioSyncStage(
  map: AudioSyncMap | null,
  generatedPackage: AudioSyncGeneratedPackage | null | undefined,
  options: DeriveAudioSyncStatusOptions = {},
): AudioSyncStage {
  if (options.legacyMapDetected || (map && map.version !== AUDIO_SYNC_MAP_VERSION)) {
    return 'legacy';
  }
  if (!map) {
    return 'none';
  }
  if (generatedPackage?.validation.valid || options.runtimeReady || options.allowJsonFallback) {
    return 'ready';
  }
  return 'intermediate';
}

export function buildAudioSyncStatus(
  input: {
    asset: BookAudioAsset | null;
    map: AudioSyncMap | null;
    job: AudioSyncJobStatus | null;
    report: AudioAlignmentReport | null;
    package?: AudioSyncGeneratedPackage | null;
  },
  options: DeriveAudioSyncStatusOptions = {},
): AudioSyncStatus {
  const syncStage = deriveAudioSyncStage(input.map, input.package, options);
  return {
    ...input,
    package: input.package ?? null,
    playable: Boolean(input.asset),
    synced: syncStage === 'ready',
    chapterFallback: input.map?.granularity === 'chapter' || input.map?.status === 'partial',
    syncStage,
  };
}

/**
 * Returns true when a correction sidecar exists and was updated after the
 * generated EPUB3 package was created — meaning the package is stale and
 * should be regenerated before playback.
 */
export function hasStaleCorrectionsSince(
  sidecar: AudioSyncCorrectionSidecar | null | undefined,
  generatedPackage: AudioSyncGeneratedPackage | null | undefined,
): boolean {
  if (!sidecar || !generatedPackage) {
    return false;
  }
  return sidecar.updatedAt > generatedPackage.createdAt;
}
