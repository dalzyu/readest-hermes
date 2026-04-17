import React, { useRef } from 'react';
import { useTranslation } from '@/hooks/useTranslation';
import { useBookDataStore } from '@/store/bookDataStore';
import { useSettingsStore } from '@/store/settingsStore';
import { useReaderStore } from '@/store/readerStore';
import { cancelBookIndexing, indexBook } from '@/services/ai/ragService';

interface IndexBookButtonProps {
  bookKey: string;
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

  const running = useRef(false);
  const progress = indexingProgress[bookKey];

  const handleStart = async () => {
    if (running.current) return;
    const bookData = getBookData(bookKey);
    const hash = bookData?.book?.hash;
    if (!hash || !bookData?.bookDoc) return;
    running.current = true;
    startIndexing(bookKey);
    try {
      await indexBook(
        bookData.bookDoc as Parameters<typeof indexBook>[0],
        hash,
        settings.aiSettings,
        (nextProgress) => updateIndexingProgress(bookKey, nextProgress),
      );
      finishIndexing(bookKey);
    } catch {
      cancelIndexing(bookKey);
    } finally {
      running.current = false;
    }
  };

  if (progress) {
    return (
      <button
        className='btn btn-ghost btn-xs h-7 min-h-7'
        onClick={() => {
          const hash = getBookData(bookKey)?.book?.hash;
          if (hash) cancelBookIndexing(hash);
          cancelIndexing(bookKey);
        }}
      >
        {_('Stop Index')}
      </button>
    );
  }

  return (
    <button className='btn btn-ghost btn-xs h-7 min-h-7' onClick={() => void handleStart()}>
      {_('Index')}
    </button>
  );
};

export default IndexBookButton;
