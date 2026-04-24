import { create } from 'zustand';

import { AUDIO_SYNC_DEFAULT_PLAYBACK_RATE } from '@/services/audioSync/constants';
import { buildAudioSyncStatus } from '@/services/audioSync/status';
import {
  AudioAlignmentReport,
  AudioSyncJobStatus,
  AudioSyncMap,
  AudioSyncSegment,
  AudioSyncSessionState,
  AudioSyncStatus,
  BookAudioAsset,
} from '@/services/audioSync/types';

interface AudioSyncStore {
  sessionStates: Record<string, AudioSyncSessionState>;
  statuses: Record<string, AudioSyncStatus>;
  setStatus: (bookHash: string, status: AudioSyncStatus) => void;
  setSessionState: (bookHash: string, updates: Partial<AudioSyncSessionState>) => void;
  resetSessionState: (bookHash: string) => void;
  setBookAudioAsset: (bookHash: string, asset: BookAudioAsset | null) => void;
  setAudioSyncMap: (bookHash: string, map: AudioSyncMap | null) => void;
  setAudioSyncJob: (bookHash: string, job: AudioSyncJobStatus | null) => void;
  setAudioAlignmentReport: (bookHash: string, report: AudioAlignmentReport | null) => void;
  setPlaybackError: (bookHash: string, error?: string) => void;
  clearStatus: (bookHash: string) => void;
  getStatus: (bookHash: string) => AudioSyncStatus;
  getSessionState: (bookHash: string) => AudioSyncSessionState;
  getSegmentForTime: (bookHash: string, timeMs: number) => AudioSyncSegment | null;
}

function createEmptyStatus(): AudioSyncStatus {
  return buildAudioSyncStatus({
    asset: null,
    map: null,
    job: null,
    report: null,
    package: null,
  });
}

function createInitialSessionState(bookHash: string): AudioSyncSessionState {
  return {
    bookHash,
    audioAssetId: null,
    syncMapId: null,
    mode: 'idle',
    followMode: 'audio',
    currentTimeMs: 0,
    durationMs: 0,
    activeSegmentId: null,
    activeWordId: null,
    playbackRate: AUDIO_SYNC_DEFAULT_PLAYBACK_RATE,
  };
}

function deriveStatus(status: AudioSyncStatus): AudioSyncStatus {
  return buildAudioSyncStatus(
    {
      asset: status.asset,
      map: status.map,
      job: status.job,
      report: status.report,
      package: status.package ?? null,
    },
    { legacyMapDetected: status.syncStage === 'legacy' },
  );
}

export const useAudioSyncStore = create<AudioSyncStore>((set, get) => ({
  sessionStates: {},
  statuses: {},
  setStatus: (bookHash, status) =>
    set((state) => ({
      statuses: {
        ...state.statuses,
        [bookHash]: status,
      },
      sessionStates: {
        ...state.sessionStates,
        [bookHash]: {
          ...(state.sessionStates[bookHash] ?? createInitialSessionState(bookHash)),
          audioAssetId: status.asset?.id ?? null,
          durationMs: status.asset?.durationMs ?? 0,
          syncMapId: status.map?.id ?? null,
        },
      },
    })),
  setSessionState: (bookHash, updates) =>
    set((state) => ({
      sessionStates: {
        ...state.sessionStates,
        [bookHash]: {
          ...(state.sessionStates[bookHash] ?? createInitialSessionState(bookHash)),
          ...updates,
        },
      },
    })),
  resetSessionState: (bookHash) =>
    set((state) => ({
      sessionStates: {
        ...state.sessionStates,
        [bookHash]: createInitialSessionState(bookHash),
      },
    })),
  setBookAudioAsset: (bookHash, asset) =>
    set((state) => {
      const current = state.statuses[bookHash] ?? createEmptyStatus();
      return {
        statuses: {
          ...state.statuses,
          [bookHash]: deriveStatus({ ...current, asset }),
        },
        sessionStates: {
          ...state.sessionStates,
          [bookHash]: {
            ...(state.sessionStates[bookHash] ?? createInitialSessionState(bookHash)),
            audioAssetId: asset?.id ?? null,
            durationMs: asset?.durationMs ?? 0,
          },
        },
      };
    }),
  setAudioSyncMap: (bookHash, map) =>
    set((state) => {
      const current = state.statuses[bookHash] ?? createEmptyStatus();
      return {
        statuses: {
          ...state.statuses,
          [bookHash]: deriveStatus({ ...current, map }),
        },
        sessionStates: {
          ...state.sessionStates,
          [bookHash]: {
            ...(state.sessionStates[bookHash] ?? createInitialSessionState(bookHash)),
            syncMapId: map?.id ?? null,
          },
        },
      };
    }),
  setAudioSyncJob: (bookHash, job) =>
    set((state) => {
      const current = state.statuses[bookHash] ?? createEmptyStatus();
      return {
        statuses: {
          ...state.statuses,
          [bookHash]: deriveStatus({ ...current, job }),
        },
      };
    }),
  setAudioAlignmentReport: (bookHash, report) =>
    set((state) => {
      const current = state.statuses[bookHash] ?? createEmptyStatus();
      return {
        statuses: {
          ...state.statuses,
          [bookHash]: deriveStatus({ ...current, report }),
        },
      };
    }),
  setPlaybackError: (bookHash, error) =>
    set((state) => ({
      sessionStates: {
        ...state.sessionStates,
        [bookHash]: {
          ...(state.sessionStates[bookHash] ?? createInitialSessionState(bookHash)),
          lastError: error,
          mode: error ? 'error' : 'idle',
        },
      },
    })),
  clearStatus: (bookHash) =>
    set((state) => {
      const statuses = { ...state.statuses };
      delete statuses[bookHash];
      const sessionStates = { ...state.sessionStates };
      delete sessionStates[bookHash];
      return { statuses, sessionStates };
    }),
  getStatus: (bookHash) => get().statuses[bookHash] ?? createEmptyStatus(),
  getSessionState: (bookHash) =>
    get().sessionStates[bookHash] ?? createInitialSessionState(bookHash),
  getSegmentForTime: (bookHash, timeMs) => {
    const map = get().statuses[bookHash]?.map;
    if (!map) {
      return null;
    }
    return (
      map.segments.find(
        (segment) => timeMs >= segment.audioStartMs && timeMs < segment.audioEndMs,
      ) ?? null
    );
  },
}));
