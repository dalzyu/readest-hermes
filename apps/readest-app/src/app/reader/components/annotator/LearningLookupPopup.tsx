import React from 'react';
import { RiRobot2Line, RiVolumeUpLine } from 'react-icons/ri';
import Popup from '@/components/Popup';
import { useLearningLookup } from '@/hooks/useLearningLookup';
import type { LookupMode } from '@/services/learning/types';
import type { Position } from '@/utils/sel';

interface LearningLookupPopupProps {
  bookKey: string;
  bookHash: string;
  selectedText: string;
  mode: LookupMode;
  position: Position;
  trianglePosition?: Position;
  popupWidth: number;
  popupHeight: number;
  onDismiss: () => void;
}

const speak = (text: string) => {
  if (typeof window === 'undefined' || !('speechSynthesis' in window)) return;
  window.speechSynthesis.cancel();
  window.speechSynthesis.speak(new SpeechSynthesisUtterance(text));
};

const LearningLookupPopup: React.FC<LearningLookupPopupProps> = ({
  bookKey,
  bookHash,
  selectedText,
  mode,
  position,
  trianglePosition,
  popupWidth,
  popupHeight,
  onDismiss,
}) => {
  const { result, loading, error, saveToVocabulary, retry } = useLearningLookup({
    bookKey,
    bookHash,
    selectedText,
    mode,
  });
  const [saved, setSaved] = React.useState(false);

  const dictionaryFirst = mode === 'dictionary';
  const dictionary = result?.dictionaryEntries ?? [];
  const translationBlock = result?.translation ? (
    <section>
      <h3 className='text-base-content/60 text-xs font-semibold uppercase'>Translation</h3>
      <p className='text-base-content text-sm'>{result.translation}</p>
    </section>
  ) : null;
  const dictionaryBlock = dictionary.length ? (
    <section>
      <h3 className='text-base-content/60 text-xs font-semibold uppercase'>Dictionary</h3>
      <div className='space-y-2'>
        {dictionary.map((entry) => (
          <article
            key={`${entry.headword}-${entry.definition}`}
            className='bg-base-200 rounded-md p-2'
          >
            <div className='font-medium'>{entry.term ?? entry.headword}</div>
            {entry.reading ? (
              <div className='text-base-content/60 text-xs'>{entry.reading}</div>
            ) : null}
            <p className='text-sm'>{entry.definition}</p>
          </article>
        ))}
      </div>
    </section>
  ) : null;

  return (
    <Popup
      width={popupWidth}
      height={popupHeight}
      position={position}
      trianglePosition={trianglePosition}
      onDismiss={onDismiss}
    >
      <div className='flex h-full flex-col gap-3 overflow-auto p-3'>
        <header className='flex items-center justify-between gap-2'>
          <div>
            <div className='text-base-content/60 text-xs uppercase'>{mode}</div>
            <h2 className='text-base-content text-base font-semibold'>{selectedText}</h2>
          </div>
          <button
            type='button'
            className='btn btn-ghost btn-sm'
            onClick={() => speak(selectedText)}
          >
            <RiVolumeUpLine />
          </button>
        </header>

        {loading ? <p className='text-base-content/60 text-sm'>Looking up…</p> : null}
        {error ? (
          <div className='bg-error/10 text-error rounded-md p-2 text-sm'>
            {error}
            <button type='button' className='ml-2 underline' onClick={retry}>
              Retry
            </button>
          </div>
        ) : null}

        {dictionaryFirst ? dictionaryBlock : translationBlock}
        {dictionaryFirst ? translationBlock : dictionaryBlock}

        {result?.phonetic ? (
          <p className='text-base-content/70 text-sm'>{result.phonetic}</p>
        ) : null}
        {result?.grammarHint ? (
          <p className='text-base-content/70 text-sm'>{result.grammarHint}</p>
        ) : null}
        {result?.frequencyBadge ? (
          <div className='badge badge-outline'>{result.frequencyBadge.level}</div>
        ) : null}
        {result?.examples.length ? (
          <section>
            <h3 className='text-base-content/60 text-xs font-semibold uppercase'>Examples</h3>
            <ul className='list-disc space-y-1 pl-4 text-sm'>
              {result.examples.map((example, index) => (
                <li key={example.exampleId ?? index}>
                  {example.text ?? example.sourceText}
                  {(example.translation ?? example.targetText) ? (
                    <span className='text-base-content/60'>
                      {' '}
                      — {example.translation ?? example.targetText}
                    </span>
                  ) : null}
                </li>
              ))}
            </ul>
          </section>
        ) : null}

        <footer className='mt-auto flex gap-2'>
          <button
            type='button'
            className='btn btn-primary btn-sm'
            disabled={!result || saved}
            onClick={async () => {
              await saveToVocabulary();
              setSaved(true);
            }}
          >
            {saved ? 'Saved' : 'Save to vocabulary'}
          </button>
          <button type='button' className='btn btn-ghost btn-sm' disabled={!result}>
            <RiRobot2Line /> Ask AI
          </button>
        </footer>
      </div>
    </Popup>
  );
};

export default LearningLookupPopup;
