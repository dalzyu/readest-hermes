import React from 'react';

export type IndexingPhase = 'idle' | 'indexing' | 'indexed' | 'empty' | 'failed';

export interface IndexingStatusProps {
  status: IndexingPhase;
  progressPercent?: number;
  chunkProgress?: { current: number; total: number };
  onIndex?: () => void;
  onReindex?: () => void;
}

export const IndexingStatus: React.FC<IndexingStatusProps> = () => {
  return null;
};
