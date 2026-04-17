import React from 'react';

interface IndexingProgressBarProps {
  current: number;
  total: number;
}

const IndexingProgressBar: React.FC<IndexingProgressBarProps> = ({ current, total }) => {
  const percent = total > 0 ? Math.min(100, Math.round((current / total) * 100)) : 0;

  return (
    <div className='bg-base-300/60 absolute bottom-0 left-0 right-0 z-30 h-1'>
      <div
        className='bg-primary h-full transition-[width] duration-150'
        style={{ width: `${percent}%` }}
      />
    </div>
  );
};

export default IndexingProgressBar;
