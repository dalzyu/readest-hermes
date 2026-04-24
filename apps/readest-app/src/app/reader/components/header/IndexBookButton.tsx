import React, { useEffect, useMemo, useRef } from 'react';

import { useTranslation } from '@/hooks/useTranslation';
import { startBookIndexing, subscribeToIndexingRun } from '@/services/ai/indexingRuntime';
import { cancelBookIndexing } from '@/services/ai/ragService';
import { detectAIAvailability } from '@/services/contextTranslation/sourceRouter';
import { useBookDataStore } from '@/store/bookDataStore';
import { useReaderStore } from '@/store/readerStore';
import { useSettingsStore } from '@/store/settingsStore';

interface IndexBookButtonProps {
  bookKey: string;
}

interface ActiveRunHandle {
  runId: string;
  abortController: AbortController;
  unsubscribe: () => void;
}

const IndexBookButton: React.FC<IndexBookButtonProps> = ({ bookKey }) => {
  const _ = useTranslation();
  const { getBookData } = useBookDataStore();
  const { settings } = useSettingsStore();
  const {
    indexingProgress,
    startIndexing,
    updateIndexingProgress,
    finishIndexing,
    cancelIndexing,
  } = useReaderStore();

  const progress = indexingProgress[bookKey];
  const activeRunRef = useRef<ActiveRunHandle | null>(null);

  const embeddingAvailable = useMemo(
    () => detectAIAvailability(settings.aiSettings).embedding,
    [settings.aiSettings],
  );

  useEffect(() => {
    return () => {
      const activeRun = activeRunRef.current;
      if (!activeRun) return;
      activeRun.abortController.abort();
      activeRun.unsubscribe();
      activeRunRef.current = null;
    };
  }, []);

  const handleStart = async () => {
    if (activeRunRef.current) return;

    const bookData = getBookData(bookKey);
    const hash = bookData?.book?.hash;
    if (!hash || !bookData?.bookDoc || !embeddingAvailable) return;

    const abortController = new AbortController();
    const { runId, promise } = startBookIndexing({
      scope: 'reader',
      key: bookKey,
      bookHash: hash,
      bookDoc: bookData.bookDoc,
      aiSettings: settings.aiSettings,
      signal: abortController.signal,
    });

    startIndexing(bookKey, runId);

    const unsubscribe = subscribeToIndexingRun('reader', bookKey, (event) => {
      if (event.runId !== runId) return;

      if (event.type === 'progress') {
        updateIndexingProgress(bookKey, runId, event.progress);
        return;
      }

      if (event.type === 'complete') {
        finishIndexing(bookKey, runId);
        return;
      }

      if (event.type === 'cancelled' || event.type === 'error') {
        cancelIndexing(bookKey, runId);
      }
    });

    activeRunRef.current = { runId, abortController, unsubscribe };

    try {
      await promise;
    } catch {
      // state updates are driven by runtime events
    } finally {
      if (activeRunRef.current?.runId === runId) {
        activeRunRef.current.unsubscribe();
        activeRunRef.current = null;
      } else {
        unsubscribe();
      }
    }
  };

  const handleStop = () => {
    const activeRun = activeRunRef.current;
    if (activeRun) {
      activeRun.abortController.abort();
      cancelIndexing(bookKey, activeRun.runId);
      return;
    }

    if (progress) {
      cancelBookIndexing(progress.runId);
      cancelIndexing(bookKey, progress.runId);
    }
  };

  const isRunning = Boolean(progress && progress.phase !== 'complete');

  if (isRunning) {
    return (
      <button className='btn btn-ghost btn-xs h-7 min-h-7' onClick={handleStop}>
        {_('Stop Index')}
      </button>
    );
  }

  return (
    <button
      className='btn btn-ghost btn-xs h-7 min-h-7'
      onClick={() => void handleStart()}
      disabled={!embeddingAvailable}
      title={!embeddingAvailable ? _('Configure an embedding model to enable indexing') : undefined}
    >
      {_('Index')}
    </button>
  );
};

export default IndexBookButton;
