import React, { useEffect, useState, useCallback } from 'react';
import { PiTrash, PiDownloadSimple, PiMagnifyingGlass } from 'react-icons/pi';
import { useTranslation } from '@/hooks/useTranslation';
import { useEnv } from '@/context/EnvContext';
import { useSettingsStore } from '@/store/settingsStore';
import { DEFAULT_CONTEXT_TRANSLATION_SETTINGS } from '@/services/contextTranslation/defaults';
import type { VocabularyEntry } from '@/services/contextTranslation/types';
import type { LookupHistoryEntry } from '@/services/contextTranslation/lookupHistoryService';
import {
  getVocabularyForBook,
  getDueVocabularyForBook,
  deleteVocabularyEntry,
  searchVocabulary,
  exportAsAnkiTSV,
  exportAsCSV,
  markVocabularyEntryReviewed,
} from '@/services/contextTranslation/vocabularyService';
import { getLookupHistoryForBook } from '@/services/contextTranslation/lookupHistoryService';
import { eventDispatcher } from '@/utils/event';

interface VocabularyPanelProps {
  bookKey: string;
  bookHash: string;
}

const RECENT_LOOKUP_LIMIT = 5;

function getRecentLookupPreview(entry: LookupHistoryEntry): string {
  const resultPreview = Object.keys(entry.result)
    .sort()
    .map((key) => entry.result[key]?.trim() ?? '')
    .find((value) => value.length > 0);
  const segments = [entry.context.trim(), resultPreview ?? ''].filter(
    (segment) => segment.length > 0,
  );
  const preview = segments.join(' · ');
  return preview.length > 72 ? `${preview.slice(0, 71).trimEnd()}…` : preview;
}

const VocabularyPanel: React.FC<VocabularyPanelProps> = ({ bookHash }) => {
  const _ = useTranslation();
  const { appService } = useEnv();
  const { settings } = useSettingsStore();

  const ctxSettings =
    settings?.globalReadSettings?.contextTranslation ?? DEFAULT_CONTEXT_TRANSLATION_SETTINGS;

  const [entries, setEntries] = useState<VocabularyEntry[]>([]);
  const [dueCount, setDueCount] = useState(0);
  const [searchQuery, setSearchQuery] = useState('');
  const [isSearching, setIsSearching] = useState(false);
  const [expandedId, setExpandedId] = useState<string | null>(null);
  const [isReviewing, setIsReviewing] = useState(false);
  const [reviewQueue, setReviewQueue] = useState<VocabularyEntry[]>([]);
  const [reviewIndex, setReviewIndex] = useState(0);
  const [isAnswerRevealed, setIsAnswerRevealed] = useState(false);
  const [isReviewSaving, setIsReviewSaving] = useState(false);
  const [recentLookups, setRecentLookups] = useState<LookupHistoryEntry[]>([]);

  const loadEntries = useCallback(async () => {
    try {
      const data = await getVocabularyForBook(bookHash);
      setEntries(data);
      return data;
    } catch {
      setEntries([]);
      return [] as VocabularyEntry[];
    }
  }, [bookHash]);

  const loadDueCount = useCallback(async () => {
    try {
      const due = await getDueVocabularyForBook(bookHash);
      setDueCount(due.length);
      return due.length;
    } catch {
      setDueCount(0);
      return 0;
    }
  }, [bookHash]);

  useEffect(() => {
    let active = true;

    (async () => {
      try {
        const data = await getVocabularyForBook(bookHash);
        if (!active) return;
        setEntries(data);
      } catch {
        if (!active) return;
        setEntries([]);
      }

      try {
        const due = await getDueVocabularyForBook(bookHash);
        if (!active) return;
        setDueCount(due.length);
      } catch {
        if (!active) return;
        setDueCount(0);
      }
    })();

    return () => {
      active = false;
    };
  }, [bookHash]);

  const loadRecentLookups = useCallback(() => {
    setRecentLookups(getLookupHistoryForBook(bookHash, RECENT_LOOKUP_LIMIT));
  }, [bookHash]);

  useEffect(() => {
    loadRecentLookups();
  }, [loadRecentLookups]);

  useEffect(() => {
    const handleLookupHistoryUpdated = (event: CustomEvent) => {
      const eventBookHash = (event.detail as { bookHash?: string } | undefined)?.bookHash;
      if (eventBookHash && eventBookHash !== bookHash) return;
      loadRecentLookups();
    };

    eventDispatcher.on('lookup-history-updated', handleLookupHistoryUpdated);
    return () => {
      eventDispatcher.off('lookup-history-updated', handleLookupHistoryUpdated);
    };
  }, [bookHash, loadRecentLookups]);

  const renderEntryFields = (entry: VocabularyEntry) => {
    const enabledFields = ctxSettings.outputFields
      .filter((f) => f.enabled)
      .sort((a, b) => a.order - b.order);

    return enabledFields.map((field) => {
      const val = entry.result[field.id];
      if (!val) return null;
      return (
        <div key={field.id} className='mt-2'>
          <p className='text-base-content/50 mb-0.5 text-xs font-medium uppercase tracking-wide'>
            {_(field.label)}
          </p>
          <p className='select-text text-sm leading-relaxed'>{val}</p>
        </div>
      );
    });
  };

  const finishReviewSession = useCallback(async () => {
    setIsReviewing(false);
    setReviewQueue([]);
    setReviewIndex(0);
    setIsAnswerRevealed(false);
    setIsReviewSaving(false);
    await loadEntries();
    await loadDueCount();
  }, [loadEntries, loadDueCount]);

  const startReview = useCallback(async () => {
    const queue = await getDueVocabularyForBook(bookHash);
    if (queue.length === 0) return;

    setSearchQuery('');
    setIsSearching(false);
    setExpandedId(null);
    setReviewQueue(queue);
    setReviewIndex(0);
    setIsAnswerRevealed(false);
    setIsReviewing(true);
  }, [bookHash]);

  const handleSearch = async (q: string) => {
    setSearchQuery(q);
    if (isReviewing) return;
    if (!q.trim()) {
      await loadEntries();
      await loadDueCount();
      return;
    }
    const results = await searchVocabulary(q);
    setEntries(results.filter((e) => e.bookHash === bookHash));
  };

  const handleDelete = async (id: string) => {
    await deleteVocabularyEntry(id);
    setEntries((prev: VocabularyEntry[]) => prev.filter((e) => e.id !== id));
    await loadDueCount();
  };

  const handleExport = async (format: 'anki' | 'csv') => {
    const content =
      format === 'anki'
        ? exportAsAnkiTSV(entries, ctxSettings.outputFields)
        : exportAsCSV(entries, ctxSettings.outputFields);
    const filename = format === 'anki' ? 'vocabulary-anki.txt' : 'vocabulary.csv';
    if (appService) {
      await appService.saveFile(filename, content);
    } else {
      const blob = new Blob([content], { type: 'text/plain;charset=utf-8' });
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = filename;
      a.click();
      URL.revokeObjectURL(url);
    }
  };

  const handleRevealAnswer = () => {
    setIsAnswerRevealed(true);
  };

  const handleExitReview = useCallback(async () => {
    await finishReviewSession();
  }, [finishReviewSession]);

  const handlePass = useCallback(async () => {
    const currentEntry = reviewQueue[reviewIndex];
    if (!currentEntry || isReviewSaving) return;

    setIsReviewSaving(true);
    try {
      const updated = await markVocabularyEntryReviewed(currentEntry, 4);
      setEntries((prev) => prev.map((entry) => (entry.id === updated.id ? updated : entry)));

      const nextIndex = reviewIndex + 1;
      if (nextIndex >= reviewQueue.length) {
        await finishReviewSession();
        return;
      }

      setReviewIndex(nextIndex);
      setIsAnswerRevealed(false);
    } finally {
      setIsReviewSaving(false);
    }
  }, [finishReviewSession, isReviewSaving, reviewIndex, reviewQueue]);

  const handleFail = useCallback(async () => {
    const currentEntry = reviewQueue[reviewIndex];
    if (!currentEntry || isReviewSaving) return;

    setIsReviewSaving(true);
    try {
      const updated = await markVocabularyEntryReviewed(currentEntry, 1);
      setEntries((prev) => prev.map((entry) => (entry.id === updated.id ? updated : entry)));

      const nextIndex = reviewIndex + 1;
      if (nextIndex >= reviewQueue.length) {
        await finishReviewSession();
        return;
      }

      setReviewIndex(nextIndex);
      setIsAnswerRevealed(false);
    } finally {
      setIsReviewSaving(false);
    }
  }, [finishReviewSession, isReviewSaving, reviewIndex, reviewQueue]);

  const enabledFields = ctxSettings.outputFields
    .filter((f) => f.enabled)
    .sort((a, b) => a.order - b.order);

  const currentReviewEntry = reviewQueue[reviewIndex] ?? null;
  const reviewButtonLabel = dueCount > 0 ? `${_('Review')} (${dueCount})` : _('Review vocabulary');
  const showRecentLookups =
    !isReviewing && !isSearching && searchQuery.trim().length === 0 && recentLookups.length > 0;

  return (
    <div className='flex h-full flex-col'>
      {/* Toolbar */}
      <div className='border-base-300/50 flex items-center gap-2 border-b px-3 py-2'>
        <div className='relative flex-1'>
          <PiMagnifyingGlass
            className='text-base-content/40 absolute left-2 top-1/2 -translate-y-1/2'
            size={14}
          />
          <input
            type='text'
            className='input input-bordered input-xs w-full pl-7'
            placeholder={_('Search vocabulary...')}
            value={searchQuery}
            disabled={isReviewing}
            onChange={(e) => handleSearch(e.target.value)}
            onFocus={() => setIsSearching(true)}
            onBlur={() => setIsSearching(false)}
          />
        </div>
        {isReviewing ? (
          <button
            className='btn btn-ghost btn-xs'
            title={_('Exit review')}
            disabled={isReviewSaving}
            onClick={handleExitReview}
          >
            {_('Exit review')}
          </button>
        ) : (
          <button
            className='btn btn-ghost btn-xs'
            title={reviewButtonLabel}
            disabled={dueCount === 0}
            onClick={() => void startReview()}
          >
            {reviewButtonLabel}
          </button>
        )}
        <button
          className='btn btn-ghost btn-xs'
          title={_('Export as Anki TSV')}
          disabled={entries.length === 0}
          onClick={() => handleExport('anki')}
        >
          <PiDownloadSimple size={16} />
        </button>
      </div>

      {isReviewing && currentReviewEntry ? (
        <div className='flex min-h-0 flex-1 flex-col gap-3 overflow-y-auto px-3 py-3'>
          <div className='border-base-300 bg-base-100 rounded-lg border p-4'>
            <div className='text-base-content/50 mb-2 flex items-center justify-between text-xs uppercase tracking-wide'>
              <span>{_('Review session')}</span>
              <span>{`${reviewIndex + 1}/${reviewQueue.length}`}</span>
            </div>
            <p className='text-lg font-medium'>{currentReviewEntry.term}</p>
            {currentReviewEntry.context && (
              <p className='text-base-content/50 mt-2 text-sm leading-relaxed'>
                {currentReviewEntry.context}
              </p>
            )}

            {isAnswerRevealed ? (
              <div className='mt-4'>{renderEntryFields(currentReviewEntry)}</div>
            ) : (
              <p className='text-base-content/50 mt-4 text-sm'>
                {_('Reveal the answer when you are ready, then choose Again or Good.')}
              </p>
            )}
          </div>

          <div className='flex items-center gap-2'>
            {!isAnswerRevealed ? (
              <button className='btn btn-secondary btn-sm' onClick={handleRevealAnswer}>
                {_('Reveal answer')}
              </button>
            ) : (
              <>
                <button
                  className='btn btn-error btn-sm'
                  disabled={isReviewSaving}
                  onClick={() => void handleFail()}
                >
                  {_('Again')}
                </button>
                <button
                  className='btn btn-success btn-sm'
                  disabled={isReviewSaving}
                  onClick={() => void handlePass()}
                >
                  {_('Good')}
                </button>
              </>
            )}
          </div>
        </div>
      ) : (
        <div className='flex-1 overflow-y-auto px-3 py-2'>
          {showRecentLookups && (
            <section className='mb-3'>
              <div className='text-base-content/50 mb-1 flex items-center justify-between text-[11px] uppercase tracking-wide'>
                <span>{_('Recent lookups')}</span>
                <span>{recentLookups.length}</span>
              </div>
              <ul className='space-y-1'>
                {recentLookups.map((entry) => {
                  const preview = getRecentLookupPreview(entry);
                  return (
                    <li
                      key={entry.id}
                      className='border-base-300 bg-base-100 rounded-lg border px-3 py-2'
                    >
                      <p className='truncate text-sm font-medium'>{entry.term}</p>
                      {preview && (
                        <p className='text-base-content/50 mt-0.5 truncate text-xs'>{preview}</p>
                      )}
                    </li>
                  );
                })}
              </ul>
            </section>
          )}
          {entries.length === 0 && (
            <p className='text-base-content/50 mt-8 text-center text-sm'>
              {isSearching || searchQuery
                ? _('No entries match your search')
                : _('No vocabulary saved yet.\nSelect text and tap the bookmark icon.')}
            </p>
          )}
          <ul className='space-y-2'>
            {entries.map((entry) => (
              <li key={entry.id}>
                <div className='collapse-arrow border-base-300 bg-base-100 collapse rounded-lg border'>
                  <input
                    type='checkbox'
                    checked={expandedId === entry.id}
                    onChange={() => setExpandedId(expandedId === entry.id ? null : entry.id)}
                  />
                  <div className='collapse-title flex h-auto min-h-0 items-center justify-between px-3 py-2 pe-8'>
                    <div className='min-w-0'>
                      <p className='truncate text-sm font-medium'>{entry.term}</p>
                      {entry.context && (
                        <p className='text-base-content/50 mt-0.5 truncate text-xs'>
                          {entry.context.slice(0, 60)}
                          {entry.context.length > 60 ? '\u2026' : ''}
                        </p>
                      )}
                    </div>
                  </div>
                  <div className='collapse-content px-3 pb-3'>
                    {enabledFields.map((field) => {
                      const val = entry.result[field.id];
                      if (!val) return null;
                      return (
                        <div key={field.id} className='mt-2'>
                          <p className='text-base-content/50 mb-0.5 text-xs font-medium uppercase tracking-wide'>
                            {_(field.label)}
                          </p>
                          <p className='select-text text-sm leading-relaxed'>{val}</p>
                        </div>
                      );
                    })}
                    <div className='mt-3 flex items-center justify-between'>
                      <p className='text-base-content/30 text-xs'>
                        {new Date(entry.addedAt).toLocaleDateString()}
                      </p>
                      <button
                        className='btn btn-ghost btn-xs text-error'
                        onClick={() => handleDelete(entry.id)}
                        title={_('Delete')}
                      >
                        <PiTrash size={14} />
                      </button>
                    </div>
                  </div>
                </div>
              </li>
            ))}
          </ul>
        </div>
      )}
    </div>
  );
};

export default VocabularyPanel;
