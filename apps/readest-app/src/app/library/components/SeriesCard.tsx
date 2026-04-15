import clsx from 'clsx';
import React, { useEffect, useMemo, useState } from 'react';

import { useEnv } from '@/context/EnvContext';
import { useSettingsStore } from '@/store/settingsStore';
import { useTranslation } from '@/hooks/useTranslation';
import { eventDispatcher } from '@/utils/event';
import { DocumentLoader } from '@/libs/document';
import { indexBook } from '@/services/ai';
import { aiLogger } from '@/services/ai/logger';
import { aiStore } from '@/services/ai/storage/aiStore';
import type { AISettings, IndexResult } from '@/services/ai/types';
import type { Book } from '@/types/book';
import type { AppService } from '@/types/system';
import type { BookSeries } from '@/services/contextTranslation/types';

type SeriesIndexSummary = {
  indexed: number;
  skipped: number;
  failed: number;
  warnings: number;
};

export function buildSeriesIndexMessage(
  summary: SeriesIndexSummary,
  translate: ReturnType<typeof useTranslation>,
): { message: string; type: 'info' | 'success' | 'warning' | 'error' } {
  const lines: string[] = [];

  if (summary.indexed > 0) {
    lines.push(translate('Indexed {{count}} volume(s)', { count: summary.indexed }));
  }
  if (summary.warnings > 0) {
    lines.push(
      translate('Indexed with warnings for {{count}} volume(s)', { count: summary.warnings }),
    );
  }
  if (summary.skipped > 0) {
    lines.push(translate('Skipped {{count}} volume(s)', { count: summary.skipped }));
  }
  if (summary.failed > 0) {
    lines.push(translate('Failed to index {{count}} volume(s)', { count: summary.failed }));
  }

  const type =
    summary.failed > 0
      ? summary.indexed > 0 || summary.warnings > 0 || summary.skipped > 0
        ? 'warning'
        : 'error'
      : summary.warnings > 0
        ? 'warning'
        : summary.indexed > 0
          ? 'success'
          : 'info';

  return {
    message: lines.join('\n') || translate('No volumes needed indexing'),
    type,
  };
}

export async function loadSeriesIndexStates(series: BookSeries): Promise<Record<string, boolean>> {
  const entries = await Promise.all(
    series.volumes.map(async (volume) => [
      volume.bookHash,
      await aiStore.isIndexed(volume.bookHash),
    ]),
  );

  return Object.fromEntries(entries);
}

export async function indexSeriesVolumes(
  series: BookSeries,
  libraryBooks: Book[],
  appService: AppService | null | undefined,
  aiSettings: AISettings | undefined,
): Promise<SeriesIndexSummary> {
  if (!appService || !aiSettings) return { indexed: 0, skipped: 0, failed: 0, warnings: 0 };

  let indexed = 0;
  let skipped = 0;
  let failed = 0;
  let warnings = 0;

  const orderedVolumes = [...series.volumes].sort((a, b) => a.volumeIndex - b.volumeIndex);
  for (const volume of orderedVolumes) {
    const book = libraryBooks.find((item) => item.hash === volume.bookHash);
    if (!book) continue;

    if (await aiStore.isIndexed(volume.bookHash)) {
      skipped++;
      continue;
    }

    try {
      const { file } = await appService.loadBookContent(book);
      const loader = new DocumentLoader(file);
      const { book: bookDoc } = await loader.open();
      const result: IndexResult = await indexBook(
        bookDoc as Parameters<typeof indexBook>[0],
        book.hash,
        aiSettings,
      );
      if (result.status === 'complete') {
        indexed++;
      } else if (result.status === 'partial') {
        warnings++;
      } else if (result.status === 'already-indexed') {
        skipped++;
      } else if (result.status === 'empty') {
        skipped++;
      }
    } catch (error) {
      failed++;
      aiLogger.rag.indexError(volume.bookHash, `indexSeriesVolumes: ${error}`);
    }
  }

  return { indexed, skipped, failed, warnings };
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
      const summary = await indexSeriesVolumes(
        series,
        libraryBooks,
        appService,
        settings.aiSettings,
      );
      setIndexStates(await loadSeriesIndexStates(series));
      const toast = buildSeriesIndexMessage(summary, _);
      void eventDispatcher.dispatch('toast', toast);
      await onIndexed?.();
    } finally {
      setIsIndexing(false);
    }
  };

  return (
    <article className='bg-base-100 border-base-300 rounded-2xl border p-4 shadow-sm'>
      <div className='mb-3 flex items-start justify-between gap-3'>
        <div className='min-w-0'>
          <h3 className='truncate text-base font-semibold'>{series.name}</h3>
          <p className='text-base-content/60 text-sm'>
            {_('{{count}} volume(s)', { count: orderedVolumes.length })}
          </p>
        </div>
        <div className='flex gap-2'>
          <button className='btn btn-ghost btn-sm' onClick={handleManage}>
            {_('Manage')}
          </button>
          <button className='btn btn-primary btn-sm' onClick={handleIndexAll} disabled={isIndexing}>
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
              className='border-base-300 flex items-center justify-between gap-3 rounded-xl border px-3 py-2'
            >
              <div className='min-w-0'>
                <div className='text-sm font-medium'>
                  {volume.label || _('Vol. {{n}}', { n: volume.volumeIndex })}
                </div>
                <div className='text-base-content/60 truncate text-xs'>
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
