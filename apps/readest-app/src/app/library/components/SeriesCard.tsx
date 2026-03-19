import clsx from 'clsx';
import React, { useEffect, useMemo, useState } from 'react';

import { useEnv } from '@/context/EnvContext';
import { useSettingsStore } from '@/store/settingsStore';
import { useTranslation } from '@/hooks/useTranslation';
import { eventDispatcher } from '@/utils/event';
import { DocumentLoader } from '@/libs/document';
import { indexBook } from '@/services/ai';
import { aiStore } from '@/services/ai/storage/aiStore';
import type { AISettings } from '@/services/ai/types';
import type { Book } from '@/types/book';
import type { AppService } from '@/types/system';
import type { BookSeries } from '@/services/contextTranslation/types';

export async function loadSeriesIndexStates(series: BookSeries): Promise<Record<string, boolean>> {
  const entries = await Promise.all(
    series.volumes.map(async (volume) => [volume.bookHash, await aiStore.isIndexed(volume.bookHash)]),
  );

  return Object.fromEntries(entries);
}

export async function indexSeriesVolumes(
  series: BookSeries,
  libraryBooks: Book[],
  appService: AppService | null | undefined,
  aiSettings: AISettings | undefined,
): Promise<void> {
  if (!appService || !aiSettings) return;

  const orderedVolumes = [...series.volumes].sort((a, b) => a.volumeIndex - b.volumeIndex);
  for (const volume of orderedVolumes) {
    const book = libraryBooks.find((item) => item.hash === volume.bookHash);
    if (!book) continue;

    const { file } = await appService.loadBookContent(book);
    const loader = new DocumentLoader(file);
    const { book: bookDoc } = await loader.open();
    await indexBook(bookDoc as Parameters<typeof indexBook>[0], book.hash, aiSettings);
  }
}

interface SeriesCardProps {
  series: BookSeries;
  libraryBooks: Book[];
  onIndexed?: () => Promise<void> | void;
}

const SeriesCard: React.FC<SeriesCardProps> = ({ series, libraryBooks, onIndexed }) => {
  const _ = useTranslation();
  const { appService } = useEnv();
  const { settings } = useSettingsStore();
  const [indexStates, setIndexStates] = useState<Record<string, boolean>>({});
  const [isIndexing, setIsIndexing] = useState(false);

  const orderedVolumes = useMemo(
    () => [...series.volumes].sort((a, b) => a.volumeIndex - b.volumeIndex),
    [series.volumes],
  );

  useEffect(() => {
    let cancelled = false;

    const loadStates = async () => {
      const nextStates = await loadSeriesIndexStates(series);
      if (!cancelled) {
        setIndexStates(nextStates);
      }
    };

    loadStates();

    return () => {
      cancelled = true;
    };
  }, [series]);

  const handleManage = async () => {
    const firstVolume = orderedVolumes[0];
    const firstBook = libraryBooks.find((book) => book.hash === firstVolume?.bookHash);
    if (!firstVolume || !firstBook) return;

    await eventDispatcher.dispatch('manage-series', {
      hash: firstVolume.bookHash,
      title: firstBook.title,
    });
  };

  const handleIndexAll = async () => {
    setIsIndexing(true);
    try {
      await indexSeriesVolumes(series, libraryBooks, appService, settings.aiSettings);
      setIndexStates(await loadSeriesIndexStates(series));
      await onIndexed?.();
    } finally {
      setIsIndexing(false);
    }
  };

  return (
    <article className='bg-base-100 rounded-2xl border border-base-300 p-4 shadow-sm'>
      <div className='mb-3 flex items-start justify-between gap-3'>
        <div className='min-w-0'>
          <h3 className='truncate text-base font-semibold'>{series.name}</h3>
          <p className='text-sm text-base-content/60'>
            {_('{{count}} volume(s)', { count: orderedVolumes.length })}
          </p>
        </div>
        <div className='flex gap-2'>
          <button className='btn btn-ghost btn-sm' onClick={handleManage}>
            {_('Manage')}
          </button>
          <button
            className='btn btn-primary btn-sm'
            onClick={handleIndexAll}
            disabled={isIndexing}
          >
            {isIndexing ? _('Indexing...') : _('Index All')}
          </button>
        </div>
      </div>
      <ul className='space-y-2'>
        {orderedVolumes.map((volume) => {
          const book = libraryBooks.find((item) => item.hash === volume.bookHash);
          const indexed = indexStates[volume.bookHash];

          return (
            <li
              key={volume.bookHash}
              className='flex items-center justify-between gap-3 rounded-xl border border-base-300 px-3 py-2'
            >
              <div className='min-w-0'>
                <div className='text-sm font-medium'>
                  {volume.label || _('Vol. {{n}}', { n: volume.volumeIndex })}
                </div>
                <div className='truncate text-xs text-base-content/60'>
                  {book?.title || volume.bookHash}
                </div>
              </div>
              <span
                className={clsx(
                  'rounded-full px-2 py-1 text-xs font-medium',
                  indexed ? 'bg-success/15 text-success' : 'bg-base-300 text-base-content/60',
                )}
              >
                {indexed ? _('Indexed') : _('Not indexed')}
              </span>
            </li>
          );
        })}
      </ul>
    </article>
  );
};

export default SeriesCard;
