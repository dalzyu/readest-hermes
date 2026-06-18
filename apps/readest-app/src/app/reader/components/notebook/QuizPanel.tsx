import React, { useEffect, useState } from 'react';
import {
  getDueVocabularyForBook,
  getVocabularyForBook,
  markVocabularyEntryReviewed,
} from '@/services/learning/vocabularyService';
import type { VocabularyEntry } from '@/services/learning/types';

interface QuizPanelProps {
  bookKey: string;
  bookHash: string;
  initialMode?: 'vocabulary' | 'comprehension';
}

const QuizPanel: React.FC<QuizPanelProps> = ({ bookHash, initialMode = 'vocabulary' }) => {
  const [mode, setMode] = useState(initialMode);
  const [entries, setEntries] = useState<VocabularyEntry[]>([]);
  const [answerVisible, setAnswerVisible] = useState(false);

  useEffect(() => {
    if (!bookHash) return;
    const load = async () => {
      setEntries(
        mode === 'vocabulary'
          ? await getDueVocabularyForBook(bookHash)
          : await getVocabularyForBook(bookHash),
      );
      setAnswerVisible(false);
    };
    void load();
  }, [bookHash, mode]);
  const handleReviewed = async (grade: 'good' | 'again') => {
    const current = entries[0];
    if (!current) return;
    await markVocabularyEntryReviewed(current, grade);
    setEntries((prev) => prev.slice(1));
    setAnswerVisible(false);
  };

  const current = entries[0];
  return (
    <div className='flex h-full flex-col gap-3 overflow-auto p-3'>
      <div className='tabs tabs-boxed'>
        <button
          type='button'
          className={`tab ${mode === 'vocabulary' ? 'tab-active' : ''}`}
          onClick={() => setMode('vocabulary')}
        >
          Vocabulary
        </button>
        <button
          type='button'
          className={`tab ${mode === 'comprehension' ? 'tab-active' : ''}`}
          onClick={() => setMode('comprehension')}
        >
          Comprehension
        </button>
      </div>

      {mode === 'comprehension' ? (
        <section className='border-base-300 rounded-lg border p-4'>
          <h3 className='font-semibold'>Reading comprehension</h3>
          <p className='text-base-content/60 text-sm'>
            Use the AI chat tab for generated comprehension questions while this unified quiz
            surface loads saved practice items.
          </p>
        </section>
      ) : current ? (
        <section className='border-base-300 rounded-lg border p-4'>
          <div className='text-base-content/60 text-xs uppercase'>Flashcard</div>
          <h3 className='my-3 text-xl font-semibold'>{current.term}</h3>
          {answerVisible ? (
            <p className='text-sm'>
              {current.result['translation'] || current.result['contextualMeaning']}
            </p>
          ) : null}
          <div className='mt-4 flex gap-2'>
            <button type='button' className='btn btn-sm' onClick={() => setAnswerVisible(true)}>
              Show answer
            </button>
            <button
              type='button'
              className='btn btn-sm btn-primary'
              onClick={() => handleReviewed('good')}
            >
              Good
            </button>
            <button type='button' className='btn btn-sm' onClick={() => handleReviewed('again')}>
              Again
            </button>
          </div>
        </section>
      ) : (
        <p className='text-base-content/60 text-sm'>No due vocabulary.</p>
      )}
    </div>
  );
};

export default QuizPanel;
