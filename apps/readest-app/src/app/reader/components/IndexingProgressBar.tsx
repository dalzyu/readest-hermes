import React from 'react';

import type { ReaderIndexPhase } from '@/store/readerStore';

interface IndexingProgressBarProps {
  current: number;
  total: number;
  phase?: ReaderIndexPhase;
}

const PHASE_LABELS: Partial<Record<ReaderIndexPhase, string>> = {
  chunking: 'Chunking',
  embedding: 'Embedding',
  finalizing: 'Finalizing',
};

const IndexingProgressBar: React.FC<IndexingProgressBarProps> = ({ current, total, phase }) => {
  const percent = total > 0 ? Math.min(100, Math.round((current / total) * 100)) : 0;
  const visiblePercent = percent > 0 ? Math.max(2, percent) : 0;
  const phaseLabel = phase ? PHASE_LABELS[phase] : null;

  return (
    <div className='pointer-events-none absolute bottom-0 left-0 right-0 z-30'>
      {phaseLabel && (
        <span
          data-indexing-phase
          aria-live='polite'
          className='badge badge-xs badge-neutral border-base-300/60 absolute -top-5 right-2 border'
        >
          {phaseLabel}
        </span>
      )}
      <div data-indexing-track className='bg-base-300/60 h-1.5 sm:h-2'>
        <div
          data-indexing-fill
          className='bg-primary h-full transition-[width] duration-150'
          style={{ width: `${visiblePercent}%` }}
        />
      </div>
    </div>
  );
};

export default IndexingProgressBar;
