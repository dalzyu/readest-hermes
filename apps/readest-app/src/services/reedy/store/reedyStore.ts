import { create } from 'zustand';

export interface ReedyMessage {
  id: string;
  role: 'user' | 'assistant' | 'system';
  content: string;
  timestamp: number;
}

interface ReedyStore {
  messages: ReedyMessage[];
  isRunning: boolean;
  addMessage: (msg: ReedyMessage) => void;
  setRunning: (running: boolean) => void;
  clear: () => void;
}

export const useReedyStore = create<ReedyStore>((set) => ({
  messages: [],
  isRunning: false,
  addMessage: (msg) => set((s) => ({ messages: [...s.messages, msg] })),
  setRunning: (running) => set({ isRunning: running }),
  clear: () => set({ messages: [], isRunning: false }),
}));
