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
  buildShortAnswerGradingPrompt,
  parseComprehensionResponse,
  parseShortAnswerGradingResponse,
} from '@/services/contextTranslation/comprehensionService';
import type {
  ComprehensionQuestion,
  ShortAnswerGradeResult,
} from '@/services/contextTranslation/comprehensionService';

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
  const [checkingAnswers, setCheckingAnswers] = useState(false);
  const [shortAnswerGrades, setShortAnswerGrades] = useState<
    Record<string, ShortAnswerGradeResult>
  >({});

  const generateQuestions = useCallback(async () => {
    setLoading(true);
    setError(null);
    setQuestions([]);
    setAnswers({});
    setRevealed(new Set());
    setScore(null);
    setCheckingAnswers(false);
    setShortAnswerGrades({});

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

  const handleCheckAnswers = useCallback(async () => {
    if (checkingAnswers) return;
    setCheckingAnswers(true);

    try {
      const newRevealed = new Set<string>();
      let correct = 0;
      let total = 0;
      let gradeMap: Record<string, ShortAnswerGradeResult> = {};

      const shortAnswerQuestions = questions.filter((question) => question.type === 'short-answer');
      if (shortAnswerQuestions.length > 0) {
        const gradingItems = shortAnswerQuestions
          .map((question) => ({
            questionId: question.id,
            question: question.question,
            expectedAnswer: question.suggestedAnswer?.trim() ?? '',
            userAnswer: String(answers[question.id] ?? '').trim(),
          }))
          .filter((item) => item.expectedAnswer && item.userAnswer);

        if (gradingItems.length > 0) {
          try {
            const aiSettings = settings?.aiSettings ?? DEFAULT_AI_SETTINGS;
            const { provider, modelId, inferenceParams } = getProviderForTask(aiSettings, 'chat');
            const model = provider.getModel(modelId, inferenceParams);
            const { systemPrompt, userPrompt } = buildShortAnswerGradingPrompt(
              gradingItems,
              bookLanguage,
            );
            const gradingRaw = await callLLM(
              systemPrompt,
              userPrompt,
              model,
              undefined,
              inferenceParams,
            );
            gradeMap = Object.fromEntries(
              parseShortAnswerGradingResponse(gradingRaw).map((grade) => [grade.questionId, grade]),
            );
          } catch {
            // fall back below when grading fails
          }
        }

        for (const question of shortAnswerQuestions) {
          if (gradeMap[question.id]) continue;
          const typedAnswer = String(answers[question.id] ?? '').trim();
          if (!typedAnswer) {
            gradeMap[question.id] = {
              questionId: question.id,
              verdict: 'incorrect',
              feedback: _('No answer provided.'),
            };
            continue;
          }
          const expected = question.suggestedAnswer?.trim() ?? '';
          const normalizedExpected = expected.toLowerCase();
          const normalizedAnswer = typedAnswer.toLowerCase();
          const verdict: ShortAnswerGradeResult['verdict'] =
            normalizedExpected && normalizedAnswer === normalizedExpected ? 'correct' : 'partial';
          gradeMap[question.id] = {
            questionId: question.id,
            verdict,
            feedback:
              verdict === 'correct'
                ? _('Good answer. It matches the expected meaning.')
                : _('Partially correct. Compare your answer with the suggested answer below.'),
          };
        }
      }

      for (const question of questions) {
        newRevealed.add(question.id);
        total++;
        if (question.type === 'multiple-choice' && question.correctIndex !== undefined) {
          if (answers[question.id] === question.correctIndex) correct++;
          continue;
        }
        if (question.type === 'short-answer' && gradeMap[question.id]?.verdict === 'correct') {
          correct++;
        }
      }

      setShortAnswerGrades(gradeMap);
      setRevealed(newRevealed);
      setScore({ correct, total });
    } finally {
      setCheckingAnswers(false);
    }
  }, [answers, bookLanguage, checkingAnswers, questions, settings?.aiSettings, _]);

  const allAnswered = questions.every((question) =>
    question.type === 'short-answer'
      ? String(answers[question.id] ?? '').trim().length > 0
      : answers[question.id] !== undefined,
  );

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
                  <div className='space-y-2'>
                    <textarea
                      className='textarea textarea-bordered textarea-sm min-h-20 w-full resize-y leading-5'
                      placeholder={_('Your answer...')}
                      value={(answers[q.id] as string) ?? ''}
                      onChange={(e) => handleShortAnswer(q.id, e.target.value)}
                      disabled={revealed.has(q.id)}
                    />
                    {revealed.has(q.id) && shortAnswerGrades[q.id] && (
                      <p
                        className={`whitespace-pre-wrap rounded-md px-2 py-1 text-xs ${
                          shortAnswerGrades[q.id]!.verdict === 'correct'
                            ? 'bg-success/10 text-success'
                            : shortAnswerGrades[q.id]!.verdict === 'partial'
                              ? 'bg-warning/10 text-warning'
                              : 'bg-error/10 text-error'
                        }`}
                      >
                        {shortAnswerGrades[q.id]!.feedback}
                      </p>
                    )}
                    {revealed.has(q.id) && q.suggestedAnswer && (
                      <p className='text-base-content/70 whitespace-pre-wrap text-xs'>
                        <span className='font-medium'>{_('Suggested:')}</span> {q.suggestedAnswer}
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
                disabled={!allAnswered || checkingAnswers}
              >
                {checkingAnswers ? _('Checking...') : _('Check answers')}
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
