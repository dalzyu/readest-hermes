import React, { useEffect, useState, useCallback, useRef } from 'react';
import { PiTrash, PiDownloadSimple, PiMagnifyingGlass, PiSpeakerHigh } from 'react-icons/pi';
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

function getTranslationPreview(entry: VocabularyEntry): string {
  return (
    entry.result['translation'] ??
    entry.result['simpleDefinition'] ??
    Object.values(entry.result).find((v) => v?.trim()) ??
    ''
  );
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

  // Quiz mode state
  type QuizMode = 'flashcard' | 'multiple-choice' | 'fill-blank' | 'listening' | 'reverse';
  const [quizMode, setQuizMode] = useState<QuizMode>('flashcard');
  const [mcChoices, setMcChoices] = useState<string[]>([]);
  const [mcSelected, setMcSelected] = useState<number | null>(null);
  const [fillBlankInput, setFillBlankInput] = useState('');
  const [fillBlankCorrect, setFillBlankCorrect] = useState<boolean | null>(null);

  // Session stats
  const [sessionCorrect, setSessionCorrect] = useState(0);
  const [sessionTotal, setSessionTotal] = useState(0);
  const [sessionStreak, setSessionStreak] = useState(0);
  const cardStartTimeRef = useRef<number>(0);
  const [avgTimePerCard, setAvgTimePerCard] = useState(0);
  const totalTimeRef = useRef<number>(0);

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
    setMcChoices([]);
    setMcSelected(null);
    setFillBlankInput('');
    setFillBlankCorrect(null);
    setSessionCorrect(0);
    setSessionTotal(0);
    setSessionStreak(0);
    totalTimeRef.current = 0;
    setAvgTimePerCard(0);
    await loadEntries();
    await loadDueCount();
  }, [loadEntries, loadDueCount]);

  const generateMcChoices = useCallback(
    (correctEntry: VocabularyEntry, allEntries: VocabularyEntry[]) => {
      const correctAnswer = getTranslationPreview(correctEntry);
      const others = allEntries
        .filter((e) => e.id !== correctEntry.id)
        .map((e) => getTranslationPreview(e))
        .filter((t) => t !== correctAnswer);
      // Shuffle and pick up to 3 distractors
      const shuffled = others.sort(() => Math.random() - 0.5).slice(0, 3);
      const choices = [correctAnswer, ...shuffled].sort(() => Math.random() - 0.5);
      return choices;
    },
    [],
  );

  const setupCardForMode = useCallback(
    (entry: VocabularyEntry, allEntries: VocabularyEntry[]) => {
      setMcSelected(null);
      setFillBlankInput('');
      setFillBlankCorrect(null);
      setIsAnswerRevealed(false);
      cardStartTimeRef.current = Date.now();

      if (quizMode === 'multiple-choice') {
        setMcChoices(generateMcChoices(entry, allEntries));
      }
    },
    [quizMode, generateMcChoices],
  );

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
    setSessionCorrect(0);
    setSessionTotal(0);
    setSessionStreak(0);
    totalTimeRef.current = 0;
    setAvgTimePerCard(0);
    cardStartTimeRef.current = Date.now();

    if (quizMode === 'multiple-choice') {
      const allEntries = await getVocabularyForBook(bookHash);
      setMcChoices(generateMcChoices(queue[0]!, allEntries));
    }
  }, [bookHash, quizMode, generateMcChoices]);

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

  const recordCardTime = useCallback(() => {
    if (cardStartTimeRef.current > 0) {
      const elapsed = Date.now() - cardStartTimeRef.current;
      totalTimeRef.current += elapsed;
    }
  }, []);

  const advanceToNext = useCallback(
    async (passed: boolean) => {
      recordCardTime();
      setSessionTotal((t) => t + 1);
      if (passed) {
        setSessionCorrect((c) => c + 1);
        setSessionStreak((s) => s + 1);
      } else {
        setSessionStreak(0);
      }

      const nextIndex = reviewIndex + 1;
      const newTotal = sessionTotal + 1;
      setAvgTimePerCard(Math.round(totalTimeRef.current / newTotal / 1000));

      if (nextIndex >= reviewQueue.length) {
        await finishReviewSession();
        return;
      }

      setReviewIndex(nextIndex);
      const nextEntry = reviewQueue[nextIndex]!;
      const allEntries = await getVocabularyForBook(bookHash);
      setupCardForMode(nextEntry, allEntries);
    },
    [
      bookHash,
      finishReviewSession,
      recordCardTime,
      reviewIndex,
      reviewQueue,
      sessionTotal,
      setupCardForMode,
    ],
  );

  const handlePass = useCallback(async () => {
    const currentEntry = reviewQueue[reviewIndex];
    if (!currentEntry || isReviewSaving) return;

    setIsReviewSaving(true);
    try {
      const updated = await markVocabularyEntryReviewed(currentEntry, 4);
      setEntries((prev) => prev.map((entry) => (entry.id === updated.id ? updated : entry)));
      await advanceToNext(true);
    } finally {
      setIsReviewSaving(false);
    }
  }, [advanceToNext, isReviewSaving, reviewIndex, reviewQueue]);

  const handleFail = useCallback(async () => {
    const currentEntry = reviewQueue[reviewIndex];
    if (!currentEntry || isReviewSaving) return;

    setIsReviewSaving(true);
    try {
      const updated = await markVocabularyEntryReviewed(currentEntry, 1);
      setEntries((prev) => prev.map((entry) => (entry.id === updated.id ? updated : entry)));
      await advanceToNext(false);
    } finally {
      setIsReviewSaving(false);
    }
  }, [advanceToNext, isReviewSaving, reviewIndex, reviewQueue]);

  const handleMcSelect = useCallback(
    async (choiceIndex: number) => {
      if (mcSelected !== null || isReviewSaving) return;
      const currentEntry = reviewQueue[reviewIndex];
      if (!currentEntry) return;
      setMcSelected(choiceIndex);
      const correct = mcChoices[choiceIndex] === getTranslationPreview(currentEntry);
      setIsAnswerRevealed(true);

      setIsReviewSaving(true);
      try {
        const grade = correct ? 4 : 1;
        const updated = await markVocabularyEntryReviewed(currentEntry, grade as 1 | 4);
        setEntries((prev) => prev.map((entry) => (entry.id === updated.id ? updated : entry)));
        // Brief delay so user sees the result before advancing
        setTimeout(() => {
          void advanceToNext(correct);
          setIsReviewSaving(false);
        }, 800);
      } catch {
        setIsReviewSaving(false);
      }
    },
    [advanceToNext, isReviewSaving, mcChoices, mcSelected, reviewIndex, reviewQueue],
  );

  const handleFillBlankSubmit = useCallback(async () => {
    if (fillBlankCorrect !== null || isReviewSaving) return;
    const currentEntry = reviewQueue[reviewIndex];
    if (!currentEntry) return;
    const expected = currentEntry.term.toLowerCase().trim();
    const correct = fillBlankInput.toLowerCase().trim() === expected;
    setFillBlankCorrect(correct);
    setIsAnswerRevealed(true);

    setIsReviewSaving(true);
    try {
      const grade = correct ? 4 : 1;
      const updated = await markVocabularyEntryReviewed(currentEntry, grade as 1 | 4);
      setEntries((prev) => prev.map((entry) => (entry.id === updated.id ? updated : entry)));
      setTimeout(() => {
        void advanceToNext(correct);
        setIsReviewSaving(false);
      }, 1200);
    } catch {
      setIsReviewSaving(false);
    }
  }, [advanceToNext, fillBlankCorrect, fillBlankInput, isReviewSaving, reviewIndex, reviewQueue]);

  const handleSpeakTerm = useCallback((entry: VocabularyEntry) => {
    eventDispatcher.dispatch('tts-speak', {
      bookKey: '',
      text: entry.term,
      oneTime: true,
      ...(entry.sourceLanguage ? { lang: entry.sourceLanguage } : {}),
    });
  }, []);

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
          {/* Quiz mode selector */}
          <div className='flex flex-wrap gap-1'>
            {(['flashcard', 'multiple-choice', 'fill-blank', 'listening', 'reverse'] as const).map(
              (m) => (
                <button
                  key={m}
                  className={`btn btn-xs ${quizMode === m ? 'btn-primary' : 'btn-ghost'}`}
                  onClick={() => setQuizMode(m)}
                  disabled={isReviewSaving}
                >
                  {m === 'flashcard'
                    ? _('Flashcard')
                    : m === 'multiple-choice'
                      ? _('MC')
                      : m === 'fill-blank'
                        ? _('Fill')
                        : m === 'listening'
                          ? _('Listen')
                          : _('Reverse')}
                </button>
              ),
            )}
          </div>

          {/* Session stats bar */}
          {sessionTotal > 0 && (
            <div className='text-base-content/50 flex items-center gap-3 text-[11px]'>
              <span>
                {sessionCorrect}/{sessionTotal} {_('correct')}
              </span>
              {sessionStreak > 1 && <span>🔥 {sessionStreak}</span>}
              {avgTimePerCard > 0 && (
                <span>
                  ~{avgTimePerCard}s/{_('card')}
                </span>
              )}
            </div>
          )}

          <div className='border-base-300 bg-base-100 rounded-lg border p-4'>
            <div className='text-base-content/50 mb-2 flex items-center justify-between text-xs uppercase tracking-wide'>
              <span>{_('Review session')}</span>
              <span>{`${reviewIndex + 1}/${reviewQueue.length}`}</span>
            </div>

            {/* Card front — varies by quiz mode */}
            {quizMode === 'reverse' ? (
              <>
                <p className='text-lg font-medium'>{getTranslationPreview(currentReviewEntry)}</p>
                {isAnswerRevealed && (
                  <p className='text-base-content/70 mt-2 text-base'>{currentReviewEntry.term}</p>
                )}
              </>
            ) : quizMode === 'listening' ? (
              <>
                <button
                  className='btn btn-circle btn-ghost btn-sm mb-2'
                  onClick={() => handleSpeakTerm(currentReviewEntry)}
                  title={_('Listen')}
                >
                  <PiSpeakerHigh size={20} />
                </button>
                <p className='text-base-content/50 text-sm'>{_('Listen and type the word')}</p>
              </>
            ) : quizMode === 'fill-blank' ? (
              <>
                <p className='text-base-content/60 text-sm'>
                  {getTranslationPreview(currentReviewEntry)}
                </p>
                {currentReviewEntry.context && (
                  <p className='text-base-content/40 mt-1 text-xs'>{currentReviewEntry.context}</p>
                )}
              </>
            ) : (
              <>
                <p className='text-lg font-medium'>{currentReviewEntry.term}</p>
                {currentReviewEntry.context && (
                  <p className='text-base-content/50 mt-2 text-sm leading-relaxed'>
                    {currentReviewEntry.context}
                  </p>
                )}
              </>
            )}

            {/* Card answer area — varies by quiz mode */}
            {quizMode === 'flashcard' || quizMode === 'reverse' ? (
              isAnswerRevealed ? (
                <div className='mt-4'>{renderEntryFields(currentReviewEntry)}</div>
              ) : (
                <p className='text-base-content/50 mt-4 text-sm'>
                  {_('Reveal the answer when you are ready, then choose Again or Good.')}
                </p>
              )
            ) : quizMode === 'multiple-choice' ? (
              <div className='mt-3 space-y-2'>
                {mcChoices.map((choice, i) => {
                  const isCorrectChoice = choice === getTranslationPreview(currentReviewEntry);
                  const isSelectedChoice = mcSelected === i;
                  let choiceClass = 'btn btn-sm btn-outline w-full text-left justify-start';
                  if (mcSelected !== null) {
                    if (isCorrectChoice) choiceClass += ' btn-success';
                    else if (isSelectedChoice) choiceClass += ' btn-error';
                  }
                  return (
                    <button
                      key={i}
                      className={choiceClass}
                      disabled={mcSelected !== null}
                      onClick={() => void handleMcSelect(i)}
                    >
                      <span className='truncate'>{choice}</span>
                    </button>
                  );
                })}
              </div>
            ) : quizMode === 'fill-blank' || quizMode === 'listening' ? (
              <div className='mt-3'>
                <input
                  type='text'
                  className={`input input-bordered input-sm w-full ${
                    fillBlankCorrect === true
                      ? 'input-success'
                      : fillBlankCorrect === false
                        ? 'input-error'
                        : ''
                  }`}
                  placeholder={_('Type the word...')}
                  value={fillBlankInput}
                  disabled={fillBlankCorrect !== null}
                  onChange={(e) => setFillBlankInput(e.target.value)}
                  onKeyDown={(e) => {
                    if (e.key === 'Enter') void handleFillBlankSubmit();
                  }}
                />
                {fillBlankCorrect === false && (
                  <p className='text-error mt-1 text-xs'>
                    {_('Answer:')} {currentReviewEntry.term}
                  </p>
                )}
                {fillBlankCorrect === null && (
                  <button
                    className='btn btn-primary btn-sm mt-2'
                    onClick={() => void handleFillBlankSubmit()}
                  >
                    {_('Check')}
                  </button>
                )}
              </div>
            ) : null}
          </div>

          {/* Action buttons — only for flashcard / reverse modes */}
          {(quizMode === 'flashcard' || quizMode === 'reverse') && (
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
          )}
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
