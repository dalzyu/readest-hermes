import React, { useState, useCallback } from 'react';
import { PiBookOpen, PiCheck, PiX } from 'react-icons/pi';
import { useTranslation } from '@/hooks/useTranslation';
import { useSettingsStore } from '@/store/settingsStore';
import { useReaderStore } from '@/store/readerStore';
import { useBookDataStore } from '@/store/bookDataStore';
import { DEFAULT_AI_SETTINGS } from '@/services/ai/constants';
import { getProviderForTask } from '@/services/ai/providers';
import { getPopupLocalContext } from '@/services/contextTranslation/pageContextService';
import { callLLM } from '@/services/contextTranslation/llmClient';
import {
  buildComprehensionPrompt,
  parseComprehensionResponse,
} from '@/services/contextTranslation/comprehensionService';
import type { ComprehensionQuestion } from '@/services/contextTranslation/comprehensionService';

interface ComprehensionViewProps {
  bookKey: string;
}

const ComprehensionView: React.FC<ComprehensionViewProps> = ({ bookKey }) => {
  const _ = useTranslation();
  const { settings } = useSettingsStore();
  const { getProgress } = useReaderStore();
  const { getBookData } = useBookDataStore();
  const progress = getProgress(bookKey);
  const bookData = getBookData(bookKey);
  const bookHash = bookData?.book?.hash ?? '';
  const bookLanguage = bookData?.book?.primaryLanguage ?? 'en';

  const [questions, setQuestions] = useState<ComprehensionQuestion[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [answers, setAnswers] = useState<Record<string, number | string>>({});
  const [revealed, setRevealed] = useState<Set<string>>(new Set());
  const [score, setScore] = useState<{ correct: number; total: number } | null>(null);

  const generateQuestions = useCallback(async () => {
    setLoading(true);
    setError(null);
    setQuestions([]);
    setAnswers({});
    setRevealed(new Set());
    setScore(null);

    try {
      const aiSettings = settings?.aiSettings ?? DEFAULT_AI_SETTINGS;
      const { provider, modelId, inferenceParams } = getProviderForTask(aiSettings, 'chat');
      const model = provider.getModel(modelId, inferenceParams);

      // Get local context around current reading position (up to 10 pages back)
      const currentPage = progress?.page ?? 0;
      const localContext = await getPopupLocalContext(bookKey, bookHash, currentPage, 10, '', 0);

      const sectionLabel = progress?.sectionLabel ?? 'Current section';

      const { systemPrompt, userPrompt } = buildComprehensionPrompt(
        localContext.localPastContext,
        sectionLabel,
        bookLanguage,
      );

      const text = await callLLM(systemPrompt, userPrompt, model, undefined, inferenceParams);

      const parsed = parseComprehensionResponse(text);
      if (parsed.length === 0) {
        setError(_('Could not generate questions. Try again.'));
      } else {
        setQuestions(parsed);
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setLoading(false);
    }
  }, [bookHash, bookKey, progress, settings, _]);

  const handleMcAnswer = (questionId: string, choiceIndex: number) => {
    if (revealed.has(questionId)) return;
    setAnswers((prev) => ({ ...prev, [questionId]: choiceIndex }));
  };

  const handleShortAnswer = (questionId: string, text: string) => {
    setAnswers((prev) => ({ ...prev, [questionId]: text }));
  };

  const handleCheckAnswers = () => {
    const newRevealed = new Set<string>();
    let correct = 0;
    let total = 0;

    for (const q of questions) {
      newRevealed.add(q.id);
      if (q.type === 'multiple-choice' && q.correctIndex !== undefined) {
        total++;
        if (answers[q.id] === q.correctIndex) correct++;
      } else if (q.type === 'short-answer') {
        total++;
        // Short answers are self-graded — always count as attempted
      }
    }

    setRevealed(newRevealed);
    setScore({ correct, total });
  };

  const allAnswered = questions.every((q) => answers[q.id] !== undefined);

  return (
    <div className='flex h-full flex-col'>
      <div className='border-base-300/50 flex items-center gap-2 border-b px-3 py-2'>
        <PiBookOpen size={16} className='text-base-content/50' />
        <span className='text-sm font-medium'>{_('Comprehension')}</span>
        <div className='flex-1' />
        <button
          className='btn btn-ghost btn-xs'
          onClick={() => void generateQuestions()}
          disabled={loading}
        >
          {loading ? _('Generating...') : questions.length > 0 ? _('New questions') : _('Start')}
        </button>
      </div>

      <div className='flex-1 overflow-y-auto px-3 py-2'>
        {error && <p className='text-error text-sm'>{error}</p>}

        {questions.length === 0 && !loading && !error && (
          <div className='mt-8 text-center'>
            <p className='text-base-content/50 text-sm'>
              {_('Test your understanding of what you have read so far.')}
            </p>
            <button
              className='btn btn-primary btn-sm mt-4'
              onClick={() => void generateQuestions()}
            >
              {_('Generate questions')}
            </button>
          </div>
        )}

        {loading && (
          <div className='mt-8 text-center'>
            <span className='loading loading-dots loading-sm' />
            <p className='text-base-content/50 mt-2 text-sm'>{_('Generating questions...')}</p>
          </div>
        )}

        {questions.length > 0 && (
          <div className='space-y-4'>
            {questions.map((q, qi) => (
              <div key={q.id} className='border-base-300 bg-base-100 rounded-lg border p-3'>
                <p className='mb-2 text-sm font-medium'>
                  {qi + 1}. {q.question}
                </p>

                {q.type === 'multiple-choice' && q.choices ? (
                  <div className='space-y-1'>
                    {q.choices.map((choice, ci) => {
                      const isSelected = answers[q.id] === ci;
                      const isRevealed = revealed.has(q.id);
                      const isCorrect = ci === q.correctIndex;
                      let btnClass = 'btn btn-xs btn-outline w-full text-left justify-start';
                      if (isRevealed) {
                        if (isCorrect) btnClass += ' btn-success';
                        else if (isSelected && !isCorrect) btnClass += ' btn-error';
                      } else if (isSelected) {
                        btnClass += ' btn-active';
                      }
                      return (
                        <button
                          key={ci}
                          className={btnClass}
                          onClick={() => handleMcAnswer(q.id, ci)}
                          disabled={isRevealed}
                        >
                          <span className='truncate'>
                            {choice}
                            {isRevealed && isCorrect && (
                              <PiCheck className='ml-1 inline' size={12} />
                            )}
                            {isRevealed && isSelected && !isCorrect && (
                              <PiX className='ml-1 inline' size={12} />
                            )}
                          </span>
                        </button>
                      );
                    })}
                  </div>
                ) : q.type === 'short-answer' ? (
                  <div>
                    <input
                      type='text'
                      className='input input-bordered input-sm w-full'
                      placeholder={_('Your answer...')}
                      value={(answers[q.id] as string) ?? ''}
                      onChange={(e) => handleShortAnswer(q.id, e.target.value)}
                      disabled={revealed.has(q.id)}
                    />
                    {revealed.has(q.id) && q.suggestedAnswer && (
                      <p className='text-success mt-1 text-xs'>
                        {_('Suggested:')} {q.suggestedAnswer}
                      </p>
                    )}
                  </div>
                ) : null}
              </div>
            ))}

            {!score && (
              <button
                className='btn btn-primary btn-sm w-full'
                onClick={handleCheckAnswers}
                disabled={!allAnswered}
              >
                {_('Check answers')}
              </button>
            )}

            {score && (
              <div className='border-base-300 bg-base-200 rounded-lg border p-3 text-center'>
                <p className='text-lg font-medium'>
                  {score.correct}/{score.total} {_('correct')}
                </p>
              </div>
            )}
          </div>
        )}
      </div>
    </div>
  );
};

export default ComprehensionView;
