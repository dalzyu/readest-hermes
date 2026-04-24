import { create } from 'zustand';

interface AlignmentJobStore {
  activeRuns: Record<string, string>;
  polling: Record<string, boolean>;
  setActiveRun: (bookHash: string, runId: string) => void;
  clearActiveRun: (bookHash: string) => void;
  setPolling: (bookHash: string, polling: boolean) => void;
}

export const useAlignmentJobStore = create<AlignmentJobStore>((set) => ({
  activeRuns: {},
  polling: {},
  setActiveRun: (bookHash, runId) =>
    set((state) => ({
      activeRuns: { ...state.activeRuns, [bookHash]: runId },
    })),
  clearActiveRun: (bookHash) =>
    set((state) => {
      const activeRuns = { ...state.activeRuns };
      const polling = { ...state.polling };
      delete activeRuns[bookHash];
      delete polling[bookHash];
      return { activeRuns, polling };
    }),
  setPolling: (bookHash, polling) =>
    set((state) => ({
      polling: { ...state.polling, [bookHash]: polling },
    })),
}));
