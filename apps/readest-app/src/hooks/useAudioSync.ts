import { useCallback, useEffect, useRef, useState } from 'react';

import { useEnv } from '@/context/EnvContext';
import { useBookDataStore } from '@/store/bookDataStore';
import { useAudioSyncStore } from '@/store/audioSyncStore';
import { useReaderStore } from '@/store/readerStore';
import { eventDispatcher } from '@/utils/event';

import {
  createAudioPlaybackSource,
  AudioSyncPlaybackSource,
} from '@/services/audioSync/AudioSyncService';
import { ensureAudioSyncPackage } from '@/services/audioSync/AudioAlignmentService';
import { AudioSyncController } from '@/services/audioSync/AudioSyncController';
import { AUDIO_SYNC_EPUB3_FILENAME } from '@/services/audioSync/constants';
import { AudioSyncStatus } from '@/services/audioSync/types';

interface UseAudioSyncResult {
  controller: AudioSyncController | null;
  status: AudioSyncStatus | null;
  reload: (runId?: string) => Promise<void>;
}

function getControllerBindingKey(status: AudioSyncStatus): string | null {
  if (!status.asset) {
    return null;
  }
  return [
    status.asset.id,
    status.map?.id || '',
    status.package?.validation.valid ? status.package.packagePath : '',
  ].join('|');
}

export function useAudioSync(bookKey: string): UseAudioSyncResult {
  const { envConfig, appService } = useEnv();
  const { getBookData } = useBookDataStore();
  const { getView, recreateViewer } = useReaderStore();
  const currentView = useReaderStore((state) => state.viewStates[bookKey]?.view ?? null);
  const {
    getStatus,
    setPlaybackError,
    setSessionState,
    setStatus: setStoredStatus,
  } = useAudioSyncStore();

  const controllerRef = useRef<AudioSyncController | null>(null);
  const controllerBindingKeyRef = useRef<string | null>(null);
  const playbackSourceRef = useRef<AudioSyncPlaybackSource | null>(null);
  const [status, setStatus] = useState<AudioSyncStatus | null>(null);

  const disposeController = useCallback(() => {
    controllerRef.current?.dispose();
    controllerRef.current = null;
    controllerBindingKeyRef.current = null;
    playbackSourceRef.current?.revoke?.();
    playbackSourceRef.current = null;
  }, []);

  const bindController = useCallback(
    (controller: AudioSyncController, currentBookHash: string) => {
      controller.addEventListener('statechange', (event) => {
        const snapshot = (event as CustomEvent<ReturnType<AudioSyncController['getSnapshot']>>)
          .detail;
        setSessionState(currentBookHash, {
          mode: snapshot.mode,
          currentTimeMs: snapshot.currentTimeMs,
          durationMs: snapshot.durationMs,
          playbackRate: snapshot.playbackRate,
          activeSegmentId: snapshot.activeSegmentId,
          activeWordId: snapshot.activeWordId,
          followMode: snapshot.followMode,
        });
      });
      controller.addEventListener('segmentchange', (event) => {
        const segment = (event as CustomEvent<{ id?: string; cfiStart?: string } | null>).detail;
        setSessionState(currentBookHash, { activeSegmentId: segment?.id ?? null });
        if (segment?.cfiStart && controller.getSnapshot().followMode === 'audio') {
          getView(bookKey)?.goTo(segment.cfiStart);
        }
      });
    },
    [bookKey, getView, setSessionState],
  );

  const reload = useCallback(
    async (runId?: string) => {
      const book = getBookData(bookKey)?.book;
      if (!book || !appService?.isDesktopApp) {
        disposeController();
        setStatus(null);
        return;
      }

      let nextStatus = await appService.getAudioSyncStatus(book, runId);
      nextStatus = await ensureAudioSyncPackage(appService, book, nextStatus, runId);
      setStatus(nextStatus);
      setStoredStatus(book.hash, nextStatus);

      const nextControllerBindingKey = getControllerBindingKey(nextStatus);
      const currentFile = getBookData(bookKey)?.file;
      if (
        nextStatus.package?.validation.valid &&
        currentFile &&
        currentFile.name !== AUDIO_SYNC_EPUB3_FILENAME
      ) {
        recreateViewer(envConfig, bookKey);
      }

      if (!nextStatus.asset) {
        disposeController();
        return;
      }

      if (controllerRef.current && controllerBindingKeyRef.current === nextControllerBindingKey) {
        return;
      }

      disposeController();
      try {
        const playbackSource = await createAudioPlaybackSource(appService, nextStatus.asset);
        playbackSourceRef.current = playbackSource;
        const controller = new AudioSyncController({
          asset: nextStatus.asset,
          map: nextStatus.map,
          src: playbackSource.src,
          view: currentView,
        });
        controllerRef.current = controller;
        controllerBindingKeyRef.current = nextControllerBindingKey;
        bindController(controller, book.hash);
      } catch (error) {
        setPlaybackError(book.hash, error instanceof Error ? error.message : String(error));
      }
    },
    [
      appService,
      bindController,
      bookKey,
      disposeController,
      envConfig,
      getBookData,
      currentView,
      recreateViewer,
      setPlaybackError,
      setStoredStatus,
    ],
  );

  useEffect(() => {
    controllerRef.current?.setView(currentView);
  }, [currentView]);

  useEffect(() => {
    const handleSeek = async (event: CustomEvent) => {
      const detail = event.detail as { bookKey?: string; cfi?: string } | undefined;
      if (detail?.bookKey !== bookKey || !detail.cfi || !controllerRef.current) {
        return;
      }
      controllerRef.current.seekToCfi(detail.cfi);
    };

    eventDispatcher.on('audio-sync-seek', handleSeek);
    return () => {
      eventDispatcher.off('audio-sync-seek', handleSeek);
    };
  }, [bookKey]);

  useEffect(() => {
    void reload();
    return () => {
      disposeController();
    };
  }, [disposeController, reload]);

  useEffect(() => {
    const currentStatus = getStatus(bookKey.split('-')[0]!);
    if (
      currentStatus.asset ||
      currentStatus.map ||
      currentStatus.job ||
      currentStatus.report ||
      currentStatus.package
    ) {
      setStatus(currentStatus);
    }
  }, [bookKey, getStatus]);

  return {
    controller: controllerRef.current,
    status,
    reload,
  };
}
