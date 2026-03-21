import React from 'react';
import { PiInfo } from 'react-icons/pi';
import { RiBookmarkFill, RiBookmarkLine, RiVolumeUpLine } from 'react-icons/ri';
import Popup from '@/components/Popup';
import { eventDispatcher } from '@/utils/event';
import { useContextTranslation } from '@/hooks/useContextTranslation';
import useOpenAIInNotebook from '@/app/reader/hooks/useOpenAIInNotebook';
import { useTranslation } from '@/hooks/useTranslation';
import {
  getCJKLanguage,
  isChineseText,
  getPinyinLabel,
  getRetrievalStatusMeta,
  buildRetrievalInfoText,
  buildAskAboutThisMessage,
  RubyText,
  HighlightedText,
  renderExamplePhonetic,
} from './LookupPopupUtils';
import type { ContextTranslationSettings } from '@/services/contextTranslation/types';
import {
  filterRenderableExamples,
  parseStructuredExamples,
} from '@/services/contextTranslation/exampleFormatter';
import { Position } from '@/utils/sel';

interface ContextTranslationPopupProps {
  bookKey: string;
  bookHash: string;
  selectedText: string;
  currentPage: number;
  settings: ContextTranslationSettings;
  position: Position;
  trianglePosition: Position;
  popupWidth: number;
  popupHeight: number;
  onDismiss?: () => void;
}

const ContextTranslationPopup: React.FC<ContextTranslationPopupProps> = ({
  bookKey,
  bookHash,
  selectedText,
  currentPage,
  settings,
  position,
  trianglePosition,
  popupWidth,
  popupHeight,
  onDismiss,
}) => {
  const _ = useTranslation();
  const { openAIInNotebook } = useOpenAIInNotebook();
  const [saved, setSaved] = React.useState(false);

  const {
    result,
    partialResult,
    loading,
    streaming,
    activeFieldId,
    error,
    retrievalStatus,
    retrievalHints,
    popupContext,
    examples,
    annotations,
    saveToVocabulary,
  } = useContextTranslation({
    bookKey,
    bookHash,
    selectedText,
    currentPage,
    settings,
  });

  const enabledFields = settings.outputFields
    .filter((field) => field.enabled)
    .sort((a, b) => a.order - b.order);
  const displayedResult = result ?? partialResult ?? {};
  const hasDisplayedResult = Object.keys(displayedResult).length > 0;
  const displayedExamples =
    examples.length > 0
      ? examples
      : displayedResult['examples']
        ? filterRenderableExamples(
            parseStructuredExamples(displayedResult['examples']),
            selectedText,
          )
        : [];
  const selectedTextPinyin =
    annotations?.source?.phonetic ??
    (isChineseText(selectedText) ? getPinyinLabel(selectedText) : '');
  const retrievalStatusMeta = getRetrievalStatusMeta(retrievalStatus);
  const retrievalInfoText = buildRetrievalInfoText(retrievalStatus, retrievalHints);

  const handleSpeak = () => {
    eventDispatcher.dispatch('tts-speak', {
      bookKey,
      text: selectedText,
      oneTime: true,
    });
  };

  const handleSave = async () => {
    await saveToVocabulary();
    setSaved(true);
  };

  const handleAskAboutThis = async () => {
    if (!result || !popupContext) return;

    await openAIInNotebook({
      bookHash,
      newConversationTitle: `Ask about ${selectedText}`,
      firstMessageContent: buildAskAboutThisMessage(selectedText, result, popupContext),
    });
  };

  return (
    <div>
      <Popup
        trianglePosition={trianglePosition}
        width={popupWidth}
        minHeight={popupHeight}
        maxHeight={480}
        position={position}
        className='not-eink:text-white flex flex-col bg-gray-700'
        triangleClassName='text-gray-700'
        onDismiss={onDismiss}
      >
        <div className='flex items-center justify-between border-b border-gray-500/30 px-4 py-3'>
          <div className='flex min-w-0 flex-col gap-2'>
            <span className='not-eink:text-yellow-300 flex min-w-0 select-text items-center gap-2 font-medium'>
              <button
                type='button'
                onClick={handleSpeak}
                title={_('Speak')}
                className='flex-shrink-0 text-green-200/70 transition-colors hover:text-green-100'
                aria-label={_('Speak')}
              >
                <RiVolumeUpLine size={16} />
              </button>
              <span className='line-clamp-1'>{selectedText}</span>
              {selectedTextPinyin ? (
                <span className='truncate text-sm font-normal text-cyan-200'>
                  {selectedTextPinyin}
                </span>
              ) : null}
            </span>
            <div className='flex items-center gap-2'>
              <span
                className={`inline-flex items-center rounded-full border px-2 py-0.5 text-[11px] font-medium ${retrievalStatusMeta.className}`}
              >
                {_(retrievalStatusMeta.label)}
              </span>
              <button
                type='button'
                title={_(retrievalInfoText)}
                className='text-gray-300 transition-colors hover:text-white'
                aria-label={_('Retrieval context info')}
              >
                <PiInfo size={14} />
              </button>
            </div>
          </div>
          <div className='flex items-center gap-2'>
            <button
              type='button'
              onClick={handleAskAboutThis}
              disabled={!result || streaming || !popupContext}
              className='rounded-full border border-cyan-400/40 px-3 py-1 text-xs font-medium text-cyan-200 transition-colors hover:border-cyan-300 hover:text-cyan-100 disabled:opacity-40'
            >
              {_('Ask About This')}
            </button>
            <button
              onClick={handleSave}
              disabled={!result || streaming || saved}
              title={saved ? _('Saved') : _('Save to vocabulary')}
              className='text-gray-400 transition-colors hover:text-yellow-300 disabled:opacity-40'
            >
              {saved ? <RiBookmarkFill size={18} /> : <RiBookmarkLine size={18} />}
            </button>
          </div>
        </div>

        <div className='flex flex-1 flex-col gap-3 overflow-y-auto p-4'>
          {loading && !hasDisplayedResult && (
            <p className='text-sm italic text-gray-400'>{_('Translating...')}</p>
          )}
          {error && <p className='text-sm text-red-400'>{error}</p>}
          {!error &&
            (hasDisplayedResult || !loading) &&
            enabledFields.map((field) => {
              const value = displayedResult[field.id] ?? '';
              const isActive = streaming && activeFieldId === field.id;

              return (
                <div key={field.id}>
                  <h3 className='mb-1 text-xs font-medium uppercase tracking-wide text-gray-400'>
                    {_(field.label)}
                  </h3>
                  {field.id === 'examples' && displayedExamples.length > 0 ? (
                    <ol className='not-eink:text-white/90 select-text list-decimal space-y-4 pl-5 text-sm leading-relaxed'>
                      {displayedExamples.map((example, index) => {
                        const sourceLang = getCJKLanguage(
                          example.sourceText,
                          popupContext?.localPastContext ?? '',
                        );
                        const targetLang = getCJKLanguage(
                          example.targetText,
                          popupContext?.localPastContext ?? '',
                        );

                        return (
                          <li key={example.exampleId} className='space-y-2'>
                            {example.sourceText ? (
                              <div className='leading-8'>
                                {sourceLang !== 'chinese' &&
                                  renderExamplePhonetic(annotations?.source, example.exampleId)}
                                {sourceLang === 'chinese' ? (
                                  <RubyText
                                    text={example.sourceText}
                                    highlightText={selectedText}
                                    className='not-eink:text-white/95'
                                  />
                                ) : (
                                  <HighlightedText
                                    text={example.sourceText}
                                    highlightText={selectedText}
                                    className='not-eink:text-white/95'
                                  />
                                )}
                              </div>
                            ) : null}
                            {example.targetText ? (
                              <div className='leading-8 text-white/80'>
                                {targetLang !== 'chinese' &&
                                  renderExamplePhonetic(annotations?.target, example.exampleId)}
                                {targetLang === 'chinese' ? (
                                  <RubyText
                                    text={example.targetText}
                                    className='not-eink:text-white/90'
                                  />
                                ) : (
                                  <p className='whitespace-pre-wrap text-white/80'>
                                    {example.targetText}
                                  </p>
                                )}
                              </div>
                            ) : null}
                            {isActive && index === displayedExamples.length - 1 ? (
                              <span className='ml-1 animate-pulse'>|</span>
                            ) : null}
                          </li>
                        );
                      })}
                    </ol>
                  ) : (
                    <p className='not-eink:text-white/90 select-text whitespace-pre-wrap text-sm leading-relaxed'>
                      {value || (streaming ? _('Waiting...') : '')}
                      {isActive ? <span className='ml-1 animate-pulse'>|</span> : null}
                    </p>
                  )}
                </div>
              );
            })}
        </div>
      </Popup>
    </div>
  );
};

export default ContextTranslationPopup;
