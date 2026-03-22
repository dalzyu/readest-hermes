import React from 'react';
import { PiInfo } from 'react-icons/pi';
import { RiBookmarkFill, RiBookmarkLine, RiVolumeUpLine } from 'react-icons/ri';
import Popup from '@/components/Popup';
import { eventDispatcher } from '@/utils/event';
import { useContextDictionary } from '@/hooks/useContextDictionary';
import { useOpenAIInNotebook } from '@/app/reader/hooks/useOpenAIInNotebook';
import { useTranslation } from '@/hooks/useTranslation';
import {
  getCJKLanguage,
  getPinyinLabel,
  getRetrievalStatusMeta,
  buildRetrievalInfoText,
  buildAskAboutThisMessage,
  RubyText,
  HighlightedText,
  renderExamplePhonetic,
} from './LookupPopupUtils';
import type {
  ContextDictionarySettings,
  ContextTranslationSettings,
} from '@/services/contextTranslation/types';
import {
  filterRenderableExamples,
  parseStructuredExamples,
} from '@/services/contextTranslation/exampleFormatter';
import { Position } from '@/utils/sel';

interface ContextDictionaryPopupProps {
  bookKey: string;
  bookHash: string;
  selectedText: string;
  currentPage: number;
  translationSettings: ContextTranslationSettings;
  dictionarySettings: ContextDictionarySettings;
  position: Position;
  trianglePosition: Position;
  popupWidth: number;
  popupHeight: number;
  onDismiss?: () => void;
}

const ContextDictionaryPopup: React.FC<ContextDictionaryPopupProps> = ({
  bookKey,
  bookHash,
  selectedText,
  currentPage,
  translationSettings,
  dictionarySettings,
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
  } = useContextDictionary({
    bookKey,
    bookHash,
    selectedText,
    currentPage,
    translationSettings,
    dictionarySettings,
  });

  const displayedResult = result ?? partialResult ?? {};
  const hasDisplayedResult = Object.keys(displayedResult).length > 0;
  // Only show examples when streaming is complete (result is finalized with plugin annotations)
  const displayedExamples =
    result !== null && examples.length > 0
      ? examples
      : displayedResult['sourceExamples'] && !streaming
        ? filterRenderableExamples(
            parseStructuredExamples(displayedResult['sourceExamples']),
            selectedText,
          )
        : [];

  const sourceCJKLang = getCJKLanguage(selectedText, popupContext?.localPastContext ?? '');
  const selectedTextPinyin =
    annotations?.source?.phonetic ??
    (popupContext !== null && sourceCJKLang === 'chinese' ? getPinyinLabel(selectedText) : '');
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

  const simpleDefinition = displayedResult['simpleDefinition'] ?? null;
  const contextualMeaning = displayedResult['contextualMeaning'] ?? null;
  const sourceExamples = displayedResult['sourceExamples'] ?? null;

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
            <p className='text-sm italic text-gray-400'>{_('Looking up...')}</p>
          )}
          {error && <p className='text-sm text-red-400'>{error}</p>}
          {!error && (hasDisplayedResult || !loading) && (
            <>
              {simpleDefinition !== null ? (
                <div>
                  <h3 className='mb-1 text-xs font-medium uppercase tracking-wide text-gray-400'>
                    {_('Definition')}
                  </h3>
                  <p className='not-eink:text-white/90 select-text whitespace-pre-wrap text-sm leading-relaxed'>
                    {simpleDefinition}
                    {streaming && activeFieldId === 'simpleDefinition' ? (
                      <span className='ml-1 animate-pulse'>|</span>
                    ) : null}
                  </p>
                </div>
              ) : null}
              {contextualMeaning !== null ? (
                <div>
                  <h3 className='mb-1 text-xs font-medium uppercase tracking-wide text-gray-400'>
                    {_('Contextual Meaning')}
                  </h3>
                  <p className='not-eink:text-white/90 select-text whitespace-pre-wrap text-sm leading-relaxed'>
                    {contextualMeaning}
                    {streaming && activeFieldId === 'contextualMeaning' ? (
                      <span className='ml-1 animate-pulse'>|</span>
                    ) : null}
                  </p>
                </div>
              ) : null}
              {dictionarySettings.sourceExamples && displayedExamples.length > 0 ? (
                <div>
                  <h3 className='mb-1 text-xs font-medium uppercase tracking-wide text-gray-400'>
                    {_('Examples')}
                  </h3>
                  <ol className='not-eink:text-white/90 select-text list-decimal space-y-4 pl-5 text-sm leading-relaxed'>
                    {displayedExamples.map((example) => {
                      return (
                        <li key={example.exampleId} className='space-y-2'>
                          {example.sourceText ? (
                            <div className='leading-8'>
                              {sourceCJKLang !== 'chinese' &&
                                renderExamplePhonetic(annotations?.source, example.exampleId)}
                              {sourceCJKLang === 'chinese' ? (
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
                            <p className='whitespace-pre-wrap text-white/80'>
                              {example.targetText}
                            </p>
                          ) : null}
                        </li>
                      );
                    })}
                  </ol>
                </div>
              ) : dictionarySettings.sourceExamples && sourceExamples ? (
                <div>
                  <h3 className='mb-1 text-xs font-medium uppercase tracking-wide text-gray-400'>
                    {_('Examples')}
                  </h3>
                  <p className='not-eink:text-white/90 select-text whitespace-pre-wrap text-sm leading-relaxed'>
                    {sourceExamples}
                    {streaming && activeFieldId === 'sourceExamples' ? (
                      <span className='ml-1 animate-pulse'>|</span>
                    ) : null}
                  </p>
                </div>
              ) : null}
            </>
          )}
        </div>
      </Popup>
    </div>
  );
};

export default ContextDictionaryPopup;
