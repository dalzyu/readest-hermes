import { create } from 'zustand';
import type { ReedyEvent } from '../runtime/events';

export type ReedyMessage =
  | { id: string; role: 'user'; text: string; createdAt: number }
  | {
      id: string;
      role: 'assistant';
      parts: Array<
        | { type: 'text'; text: string }
        | {
            type: 'tool_call';
            id: string;
            name: string;
            args: unknown;
            permission: string;
            state: string;
          }
      >;
      createdAt: number;
    };

interface ReedyStore {
  messages: ReedyMessage[];
  isRunning: boolean;
  addMessage: (msg: ReedyMessage) => void;
  setRunning: (running: boolean) => void;
  clear: () => void;
  reset: () => void;
  startUserTurn: (text: string) => void;
  startAssistantTurn: (id: string, _controller: AbortController) => void;
  applyEvent: (event: ReedyEvent) => void;
  finishTurn: () => void;
}

export const useReedyStore = create<ReedyStore>((set) => ({
  messages: [],
  isRunning: false,
  addMessage: (msg) => set((s) => ({ messages: [...s.messages, msg] })),
  setRunning: (running) => set({ isRunning: running }),
  clear: () => set({ messages: [], isRunning: false }),
  reset: () => set({ messages: [], isRunning: false }),
  startUserTurn: (text) => {
    const msg: ReedyMessage = {
      id: `user-${Date.now()}`,
      role: 'user',
      text,
      createdAt: Date.now(),
    };
    set((s) => ({ messages: [...s.messages, msg], isRunning: true }));
  },
  startAssistantTurn: (id) => {
    const msg: ReedyMessage = {
      id,
      role: 'assistant',
      parts: [],
      createdAt: Date.now(),
    };
    set((s) => ({ messages: [...s.messages, msg] }));
  },
  applyEvent: (event) => {
    if (event.type === 'text_delta') {
      set((s) => {
        const msgs = [...s.messages];
        const last = msgs[msgs.length - 1];
        if (last?.role === 'assistant') {
          const lastPart = last.parts[last.parts.length - 1];
          if (lastPart?.type === 'text') {
            last.parts = [
              ...last.parts.slice(0, -1),
              { ...lastPart, text: lastPart.text + event.delta },
            ];
          } else {
            last.parts = [...last.parts, { type: 'text', text: event.delta }];
          }
          msgs[msgs.length - 1] = { ...last };
        }
        return { messages: msgs };
      });
    }
  },
  finishTurn: () => set({ isRunning: false }),
}));
