import React from 'react';
import ContextLookupPopup from '@/components/ContextLookupPopup';
import { eventDispatcher } from '@/utils/event';
import { useContextDictionary } from '@/hooks/useContextDictionary';
import { useOpenAIInNotebook } from '@/app/reader/hooks/useOpenAIInNotebook';
import { useTranslation } from '@/hooks/useTranslation';
import { useSettingsStore } from '@/store/settingsStore';
import {
  getCJKLanguage,
  getPinyinLabel,
  getRomajiLabel,
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
import { getJapaneseGrammarHint } from '@/services/contextTranslation/grammarHints';
import { getFrequencyBadge } from '@/services/contextTranslation/frequencyService';
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
  bookLanguage?: string;
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
  bookLanguage,
  onDismiss,
}) => {
  const _ = useTranslation();
  const { openAIInNotebook } = useOpenAIInNotebook();
  const { settings: appSettings } = useSettingsStore();
  const aiEnabled = appSettings?.aiSettings?.enabled ?? false;
  const [saved, setSaved] = React.useState(false);

  const {
    result,
    partialResult,
    loading,
    streaming,
    activeFieldId,
    error,
    aiUnavailable,
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
    bookLanguage,
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
            translationSettings.targetLanguage,
          )
        : [];

  const sourceCJKLang = getCJKLanguage(selectedText, popupContext?.localPastContext ?? '');
  const selectedTextPinyin =
    annotations?.source?.phonetic ??
    (popupContext !== null && sourceCJKLang === 'chinese'
      ? getPinyinLabel(selectedText)
      : popupContext !== null && sourceCJKLang === 'japanese'
        ? getRomajiLabel(selectedText)
        : '');
  const retrievalStatusMeta = getRetrievalStatusMeta(retrievalStatus);
  const retrievalInfoText = buildRetrievalInfoText(retrievalStatus, retrievalHints);

  // Deterministic grammar hint for Japanese (kuromoji POS analysis)
  const japaneseGrammarHint =
    sourceCJKLang === 'japanese' ? getJapaneseGrammarHint(selectedText) : null;

  // Frequency / proficiency level badge
  const detectedLang = sourceCJKLang === 'chinese' ? 'zh' : sourceCJKLang === 'japanese' ? 'ja' : (bookLanguage ?? 'en');
  const frequencyBadge = getFrequencyBadge(selectedText, detectedLang);

  const handleSpeak = () => {
    eventDispatcher.dispatch('tts-speak', {
      bookKey,
      text: selectedText,
      oneTime: true,
      ...(bookLanguage ? { lang: bookLanguage } : {}),
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
    <ContextLookupPopup
      selectedText={selectedText}
      selectedTextPinyin={selectedTextPinyin}
      retrievalStatusMeta={retrievalStatusMeta}
      retrievalInfoText={retrievalInfoText}
      loading={loading}
      aiEnabled={aiEnabled}
      hasDisplayedResult={hasDisplayedResult}
      onSpeakSelectedText={handleSpeak}
      askAboutThisEnabled={Boolean(result && !streaming && popupContext)}
      onAskAboutThis={handleAskAboutThis}
      saveEnabled={Boolean(result && !streaming && !saved)}
      saved={saved}
      onSave={handleSave}
      position={position}
      trianglePosition={trianglePosition}
      popupWidth={popupWidth}
      popupHeight={popupHeight}
      onDismiss={onDismiss}
    >
      {loading && !hasDisplayedResult && (
        <p className='text-sm italic text-gray-400'>{_('Looking up...')}</p>
      )}
      {error && <p className='text-sm text-red-400'>{error}</p>}
      {aiUnavailable && (
        <p className='mb-1 text-xs text-amber-400/80'>
          {_('AI translation unavailable — showing dictionary results only')}
        </p>
      )}
      {(japaneseGrammarHint || frequencyBadge) && (
        <div className='mb-1 flex items-center gap-2'>
          {japaneseGrammarHint && (
            <span className='text-xs italic text-gray-400'>{japaneseGrammarHint.label}</span>
          )}
          {frequencyBadge && (
            <span className='rounded bg-blue-500/20 px-1.5 py-0.5 text-[10px] font-semibold text-blue-300'>
              {frequencyBadge.level}
            </span>
          )}
        </div>
      )}
      {japaneseGrammarHint?.explanation && (
        <p className='mb-1 text-xs text-gray-400/90'>{japaneseGrammarHint.explanation}</p>
      )}
      {popupContext?.dictionaryResults && popupContext.dictionaryResults.length > 0 && (
        <details className='mb-2'>
          <summary className='cursor-pointer text-xs font-medium uppercase tracking-wide text-gray-400'>
            {_('Dictionary')}
          </summary>
          <div className='mt-1 space-y-1 pl-2'>
            {popupContext.dictionaryResults.map((entry, i) => (
              <div key={i} className='text-sm'>
                <span className='not-eink:text-white/95 font-medium'>{entry.headword}</span>
                <span className='not-eink:text-white/70 ml-1'>{entry.definition}</span>
                {entry.source && (
                  <span className='ml-1 text-xs text-gray-500'>({entry.source})</span>
                )}
              </div>
            ))}
          </div>
        </details>
      )}
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
                        <p className='whitespace-pre-wrap text-white/80'>{example.targetText}</p>
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
    </ContextLookupPopup>
  );
};

export default ContextDictionaryPopup;
