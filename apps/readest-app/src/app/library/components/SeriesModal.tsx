import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { PiPlus, PiTrash, PiX } from 'react-icons/pi';

import { useEnv } from '@/context/EnvContext';
import { useLibraryStore } from '@/store/libraryStore';
import { useSettingsStore } from '@/store/settingsStore';
import { useTranslation } from '@/hooks/useTranslation';
import { eventDispatcher } from '@/utils/event';
import { aiStore } from '@/services/ai/storage/aiStore';
import type { BookSeries } from '@/services/contextTranslation/types';
import {
  addBookToSeries,
  createSeries,
  deleteSeries,
  getAllSeries,
  getSeriesForBook,
  removeBookFromSeries,
  updateSeriesVolume,
} from '@/services/contextTranslation/seriesService';

import { buildSeriesIndexMessage, indexSeriesVolumes } from './SeriesCard';

const SeriesModal: React.FC = () => {
  const _ = useTranslation();
  const { appService } = useEnv();
  const { library } = useLibraryStore();
  const { settings } = useSettingsStore();
  const [bookHash, setBookHash] = useState<string | null>(null);
  const [bookTitle, setBookTitle] = useState('');
  const [allSeries, setAllSeries] = useState<BookSeries[]>([]);
  const [currentSeries, setCurrentSeries] = useState<BookSeries | null>(null);
  const [newSeriesName, setNewSeriesName] = useState('');
  const [creating, setCreating] = useState(false);
  const [indexStates, setIndexStates] = useState<Record<string, boolean>>({});
  const [isIndexingAll, setIsIndexingAll] = useState(false);

  const orderedVolumes = useMemo(
    () => [...(currentSeries?.volumes || [])].sort((a, b) => a.volumeIndex - b.volumeIndex),
    [currentSeries],
  );

  const loadIndexStates = useCallback(async (series: BookSeries | null) => {
    if (!series) {
      setIndexStates({});
      return;
    }

    const states = Object.fromEntries(
      await Promise.all(
        series.volumes.map(async (volume) => [
          volume.bookHash,
          await aiStore.isIndexed(volume.bookHash),
        ]),
      ),
    );
    setIndexStates(states);
  }, []);

  const loadSeries = useCallback(
    async (hash: string) => {
      const [all, current] = await Promise.all([getAllSeries(), getSeriesForBook(hash)]);
      setAllSeries(all);
      setCurrentSeries(current);
      await loadIndexStates(current);
    },
    [loadIndexStates],
  );

  useEffect(() => {
    const handler = (event: CustomEvent) => {
      const { hash, title } = event.detail as { hash: string; title: string };
      setBookHash(hash);
      setBookTitle(title);
      void loadSeries(hash);
    };

    eventDispatcher.on('manage-series', handler);
    return () => eventDispatcher.off('manage-series', handler);
  }, [loadSeries]);

  const handleClose = () => {
    setBookHash(null);
    setBookTitle('');
    setNewSeriesName('');
    setCreating(false);
    setCurrentSeries(null);
    setIndexStates({});
  };

  const refreshCurrentBook = async () => {
    if (bookHash) {
      await loadSeries(bookHash);
    }
  };

  const notifySeriesUpdated = () => {
    void eventDispatcher.dispatch('series-updated');
  };

  const handleAddToSeries = async (seriesId: string) => {
    if (!bookHash || currentSeries?.id === seriesId) return;

    try {
      await addBookToSeries(seriesId, bookHash);
      if (currentSeries) {
        try {
          await removeBookFromSeries(currentSeries.id, bookHash);
        } catch {
          try {
            await removeBookFromSeries(seriesId, bookHash);
          } catch {}
          throw new Error('failed to remove previous series membership');
        }
      }
    } catch {
      try {
        await refreshCurrentBook();
      } catch {}
      return;
    }

    await refreshCurrentBook();
    notifySeriesUpdated();
  };

  const handleRemoveFromSeries = async () => {
    if (!bookHash || !currentSeries) return;
    await removeBookFromSeries(currentSeries.id, bookHash);
    await refreshCurrentBook();
    notifySeriesUpdated();
  };

  const handleCreateAndAdd = async () => {
    const seriesName = newSeriesName.trim();
    if (!bookHash || !seriesName) return;

    let createdSeriesId: string | null = null;

    try {
      const createdSeries = await createSeries(seriesName, [bookHash]);
      createdSeriesId = createdSeries.id;

      if (currentSeries) {
        try {
          await removeBookFromSeries(currentSeries.id, bookHash);
        } catch {
          try {
            await deleteSeries(createdSeriesId);
          } catch {}
          throw new Error('failed to remove previous series membership');
        }
      }
    } catch {
      try {
        await refreshCurrentBook();
      } catch {}
      return;
    }

    setNewSeriesName('');
    setCreating(false);
    await refreshCurrentBook();
    notifySeriesUpdated();
  };

  const handleDeleteSeries = async (id: string) => {
    await deleteSeries(id);
    await refreshCurrentBook();
    notifySeriesUpdated();
  };

  const handleVolumeIndexBlur = async (targetBookHash: string, value: string) => {
    if (!currentSeries) return;
    const parsed = Number.parseInt(value, 10);
    if (!Number.isFinite(parsed) || parsed <= 0) return;
    await updateSeriesVolume(currentSeries.id, targetBookHash, { volumeIndex: parsed });
    await refreshCurrentBook();
    notifySeriesUpdated();
  };

  const handleVolumeLabelBlur = async (targetBookHash: string, value: string) => {
    if (!currentSeries) return;
    await updateSeriesVolume(currentSeries.id, targetBookHash, { label: value });
    await refreshCurrentBook();
    notifySeriesUpdated();
  };

  const handleIndexAll = async () => {
    if (!currentSeries) return;
    setIsIndexingAll(true);
    try {
      const summary = await indexSeriesVolumes(
        currentSeries,
        library,
        appService,
        settings.aiSettings,
      );
      await loadIndexStates(currentSeries);
      void eventDispatcher.dispatch('toast', buildSeriesIndexMessage(summary, _));
    } finally {
      setIsIndexingAll(false);
    }
  };

  if (!bookHash) return null;

  return (
    <dialog open className='modal modal-open z-[200]'>
      <div className='modal-box max-w-2xl'>
        <button
          className='btn btn-ghost btn-sm btn-circle absolute right-2 top-2'
          onClick={handleClose}
        >
          <PiX size={16} />
        </button>
        <h3 className='mb-1 text-base font-bold'>{_('Manage Series')}</h3>
        <p className='text-base-content/60 mb-4 truncate text-sm'>{bookTitle}</p>

        {currentSeries && (
          <section className='border-base-300 mb-4 rounded-xl border p-3'>
            <div className='mb-3 flex items-center gap-2'>
              <h4 className='text-sm font-semibold'>{currentSeries.name}</h4>
              <button className='btn btn-ghost btn-xs ml-auto' onClick={handleRemoveFromSeries}>
                {_('Remove')}
              </button>
              <button
                className='btn btn-primary btn-xs'
                onClick={handleIndexAll}
                disabled={isIndexingAll}
              >
                {isIndexingAll ? _('Indexing...') : _('Index All')}
              </button>
            </div>
            <ul className='space-y-2'>
              {orderedVolumes.map((volume) => {
                const book = library.find((item) => item.hash === volume.bookHash);
                const indexed = indexStates[volume.bookHash];

                return (
                  <li
                    key={volume.bookHash}
                    className='border-base-300 grid grid-cols-[64px,minmax(0,1fr),auto] items-center gap-2 overflow-hidden rounded-lg border px-2 py-2'
                  >
                    <input
                      type='number'
                      min={1}
                      className='input input-bordered input-xs w-16'
                      defaultValue={volume.volumeIndex}
                      aria-label={_('Volume order for {{title}}', {
                        title: book?.title || volume.bookHash,
                      })}
                      onBlur={(event) => handleVolumeIndexBlur(volume.bookHash, event.target.value)}
                    />
                    <div className='min-w-0 space-y-1'>
                      <input
                        type='text'
                        className='input input-bordered input-xs w-full'
                        defaultValue={volume.label || ''}
                        aria-label={_('Volume label for {{title}}', {
                          title: book?.title || volume.bookHash,
                        })}
                        onBlur={(event) =>
                          handleVolumeLabelBlur(volume.bookHash, event.target.value)
                        }
                      />
                      <div className='text-base-content/60 truncate text-xs'>
                        {book?.title || volume.bookHash}
                      </div>
                    </div>
                    <span
                      className={`shrink-0 whitespace-nowrap rounded-full px-2 py-1 text-xs ${
                        indexed ? 'bg-success/15 text-success' : 'bg-base-300 text-base-content/60'
                      }`}
                    >
                      {indexed ? _('Indexed') : _('Not indexed')}
                    </span>
                  </li>
                );
              })}
            </ul>
          </section>
        )}

        <p className='text-base-content/50 mb-2 text-xs font-medium uppercase tracking-wide'>
          {_('Existing Series')}
        </p>
        {allSeries.length === 0 && !creating && (
          <p className='text-base-content/40 mb-3 text-sm'>{_('No series yet.')}</p>
        )}
        <ul className='mb-3 space-y-1'>
          {allSeries.map((series) => (
            <li
              key={series.id}
              className='hover:bg-base-200 flex items-center justify-between rounded-lg px-2 py-1.5'
            >
              <button
                className='flex-1 text-left text-sm'
                onClick={() => handleAddToSeries(series.id)}
              >
                {series.name}
                {currentSeries?.id === series.id && (
                  <span className='text-success ml-2 text-xs'>&#10003;</span>
                )}
              </button>
              <button
                className='btn btn-ghost btn-xs text-error'
                onClick={() => handleDeleteSeries(series.id)}
                title={_('Delete series')}
              >
                <PiTrash size={13} />
              </button>
            </li>
          ))}
        </ul>

        {creating ? (
          <div className='flex gap-2'>
            <input
              type='text'
              className='input input-bordered input-sm flex-1'
              placeholder={_('Series name')}
              value={newSeriesName}
              onChange={(event) => setNewSeriesName(event.target.value)}
              onKeyDown={(event) => {
                if (event.key === 'Enter') void handleCreateAndAdd();
                if (event.key === 'Escape') setCreating(false);
              }}
            />
            <button className='btn btn-primary btn-sm' onClick={() => void handleCreateAndAdd()}>
              {_('Create')}
            </button>
            <button className='btn btn-ghost btn-sm' onClick={() => setCreating(false)}>
              {_('Cancel')}
            </button>
          </div>
        ) : (
          <button className='btn btn-ghost btn-sm gap-1' onClick={() => setCreating(true)}>
            <PiPlus size={14} />
            {_('New Series')}
          </button>
        )}
      </div>
      <button className='modal-backdrop' onClick={handleClose} aria-label='Close' />
    </dialog>
  );
};

export default SeriesModal;
