import React from 'react';
import ContextLookupPopup from '@/components/ContextLookupPopup';
import { useContextDictionary } from '@/hooks/useContextDictionary';
import { useOpenAIInNotebook } from '@/app/reader/hooks/useOpenAIInNotebook';
import { usePopupOwnedTTS } from './usePopupOwnedTTS';
import { usePopupTermHistory } from './usePopupTermHistory';
import LookupDebugSection from './LookupDebugSection';
import LookupDictionaryResults from './LookupDictionaryResults';
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
  const { currentTerm, canGoBack, canGoForward, goBack, goForward, pushTerm } =
    usePopupTermHistory(selectedText);
  const { settings: appSettings } = useSettingsStore();
  const aiEnabled = appSettings?.aiSettings?.enabled ?? false;
  const developerMode = appSettings?.aiSettings?.developerMode ?? false;
  const [saved, setSaved] = React.useState(false);

  const {
    result,
    partialResult,
    loading,
    streaming,
    activeFieldId,
    error,
    availabilityHint,
    retrievalStatus,
    retrievalHints,
    popupContext,
    examples,
    annotations,
    debugInfo,
    saveToVocabulary,
  } = useContextDictionary({
    bookKey,
    bookHash,
    selectedText: currentTerm,
    currentPage,
    translationSettings,
    dictionarySettings,
    bookLanguage,
  });

  const displayedResult = result ?? partialResult ?? {};
  const hasDisplayedResult = Object.keys(displayedResult).length > 0;
  const displayedExamples = examples;

  React.useEffect(() => {
    setSaved(false);
  }, [currentTerm]);

  const sourceCJKLang = getCJKLanguage(
    currentTerm,
    popupContext?.localPastContext ?? '',
    bookLanguage,
  );
  const selectedTextPinyin =
    annotations?.source?.phonetic ??
    (popupContext !== null && sourceCJKLang === 'chinese'
      ? getPinyinLabel(currentTerm)
      : popupContext !== null && sourceCJKLang === 'japanese'
        ? getRomajiLabel(currentTerm)
        : '');
  const retrievalStatusMeta = getRetrievalStatusMeta(retrievalStatus);
  const retrievalInfoText = buildRetrievalInfoText(retrievalStatus, retrievalHints);

  const japaneseGrammarHint =
    sourceCJKLang === 'japanese' ? getJapaneseGrammarHint(currentTerm) : null;
  const detectedLang =
    sourceCJKLang === 'chinese'
      ? 'zh'
      : sourceCJKLang === 'japanese'
        ? 'ja'
        : (bookLanguage ?? 'en');
  const frequencyBadge = getFrequencyBadge(currentTerm, detectedLang);

  const { speakOwnedText, stopOwnedSpeech } = usePopupOwnedTTS(bookKey);

  const handleSpeak = () => {
    speakOwnedText({
      text: currentTerm,
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
      newConversationTitle: `Ask about ${currentTerm}`,
      firstMessageContent: buildAskAboutThisMessage(currentTerm, result, popupContext),
    });
  };

  const simpleDefinition = displayedResult['simpleDefinition'] ?? null;
  const contextualMeaning = displayedResult['contextualMeaning'] ?? null;
  const sourceExamples = displayedResult['sourceExamples'] ?? null;

  const handleDismiss = () => {
    stopOwnedSpeech();
    onDismiss?.();
  };

  return (
    <ContextLookupPopup
      selectedText={currentTerm}
      selectedTextPinyin={selectedTextPinyin}
      retrievalStatusMeta={retrievalStatusMeta}
      retrievalInfoText={retrievalInfoText}
      loading={loading}
      aiEnabled={aiEnabled}
      hasDisplayedResult={hasDisplayedResult}
      availabilityHint={availabilityHint}
      onSpeakSelectedText={handleSpeak}
      askAboutThisEnabled={Boolean(result && !streaming && popupContext)}
      onAskAboutThis={handleAskAboutThis}
      saveEnabled={Boolean(result && !streaming && !saved)}
      saved={saved}
      onSave={handleSave}
      canNavigateBack={canGoBack}
      canNavigateForward={canGoForward}
      onNavigateBack={goBack}
      onNavigateForward={goForward}
      position={position}
      trianglePosition={trianglePosition}
      popupWidth={popupWidth}
      popupHeight={popupHeight}
      onDismiss={handleDismiss}
    >
      {loading && !hasDisplayedResult && (
        <p className='text-sm italic text-gray-400'>{_('Looking up...')}</p>
      )}
      {error && <p className='text-sm text-red-400'>{error}</p>}
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
        <LookupDictionaryResults
          dictionaryResults={popupContext.dictionaryResults}
          selectedText={currentTerm}
          onNavigateTerm={pushTerm}
        />
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
                              highlightText={currentTerm}
                              className='not-eink:text-white/95'
                            />
                          ) : (
                            <HighlightedText
                              text={example.sourceText}
                              highlightText={currentTerm}
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
      {developerMode && debugInfo && <LookupDebugSection debugInfo={debugInfo} />}
    </ContextLookupPopup>
  );
};

export default ContextDictionaryPopup;
