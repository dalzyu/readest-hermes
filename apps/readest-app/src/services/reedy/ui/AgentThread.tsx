import React from 'react';
import type { ReedyMessage } from '../store/reedyStore';

export interface AgentThreadProps {
  messages: ReedyMessage[];
  isRunning: boolean;
  onSourceClick?: (cfi: string) => void;
  emptyState?: React.ReactNode;
}

export const AgentThread: React.FC<AgentThreadProps> = ({ emptyState }) => {
  return <>{emptyState ?? null}</>;
};
