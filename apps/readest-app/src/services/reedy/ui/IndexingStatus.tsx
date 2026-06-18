import React from 'react';

export type IndexingPhase = 'idle' | 'indexing' | 'done' | 'error';

export interface IndexingStatusProps {
  status: IndexingPhase;
  progressPercent?: number;
  chunkProgress?: { current: number; total: number };
}

export const IndexingStatus: React.FC<IndexingStatusProps> = () => {
  return null;
};
