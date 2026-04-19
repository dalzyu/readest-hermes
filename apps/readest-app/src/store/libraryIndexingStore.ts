import { create } from 'zustand';

import type { ReaderIndexPhase } from './readerStore';

export interface LibraryIndexProgress {
  runId: string;
  current: number;
  total: number;
  phase: ReaderIndexPhase;
}

interface LibraryIndexingStore {
  indexingProgress: Record<string, LibraryIndexProgress>;
  startIndexing: (bookHash: string, runId: string) => void;
  updateIndexingProgress: (
    bookHash: string,
    runId: string,
    progress: Omit<LibraryIndexProgress, 'runId'>,
  ) => void;
  finishIndexing: (bookHash: string, runId: string) => void;
  cancelIndexing: (bookHash: string, runId?: string) => void;
}

const INDEXING_COMPLETE_HOLD_MS = 1200;
const indexingClearTimers = new Map<string, ReturnType<typeof setTimeout>>();

function clearIndexingTimer(bookHash: string): void {
  const timer = indexingClearTimers.get(bookHash);
  if (!timer) return;
  clearTimeout(timer);
  indexingClearTimers.delete(bookHash);
}

export const useLibraryIndexingStore = create<LibraryIndexingStore>((set) => ({
  indexingProgress: {},
  startIndexing: (bookHash: string, runId: string) => {
    clearIndexingTimer(bookHash);
    set((state) => ({
      indexingProgress: {
        ...state.indexingProgress,
        [bookHash]: { runId, current: 0, total: 1, phase: 'pending' },
      },
    }));
  },
  updateIndexingProgress: (
    bookHash: string,
    runId: string,
    progress: Omit<LibraryIndexProgress, 'runId'>,
  ) =>
    set((state) => {
      const currentProgress = state.indexingProgress[bookHash];
      if (!currentProgress || currentProgress.runId !== runId) {
        return state;
      }
      return {
        indexingProgress: {
          ...state.indexingProgress,
          [bookHash]: {
            runId,
            current: progress.current,
            total: progress.total,
            phase: progress.phase,
          },
        },
      };
    }),
  finishIndexing: (bookHash: string, runId: string) => {
    clearIndexingTimer(bookHash);
    set((state) => {
      const currentProgress = state.indexingProgress[bookHash];
      if (!currentProgress || currentProgress.runId !== runId) {
        return state;
      }
      return {
        indexingProgress: {
          ...state.indexingProgress,
          [bookHash]: {
            ...currentProgress,
            current: currentProgress.total,
            phase: 'complete',
          },
        },
      };
    });

    const timer = setTimeout(() => {
      set((state) => {
        const currentProgress = state.indexingProgress[bookHash];
        if (
          !currentProgress ||
          currentProgress.runId !== runId ||
          currentProgress.phase !== 'complete'
        ) {
          return state;
        }
        const indexingProgress = { ...state.indexingProgress };
        delete indexingProgress[bookHash];
        return { indexingProgress };
      });
      indexingClearTimers.delete(bookHash);
    }, INDEXING_COMPLETE_HOLD_MS);

    indexingClearTimers.set(bookHash, timer);
  },
  cancelIndexing: (bookHash: string, runId?: string) => {
    clearIndexingTimer(bookHash);
    set((state) => {
      const currentProgress = state.indexingProgress[bookHash];
      if (!currentProgress) {
        return state;
      }
      if (runId && currentProgress.runId !== runId) {
        return state;
      }
      const indexingProgress = { ...state.indexingProgress };
      delete indexingProgress[bookHash];
      return { indexingProgress };
    });
  },
}));
