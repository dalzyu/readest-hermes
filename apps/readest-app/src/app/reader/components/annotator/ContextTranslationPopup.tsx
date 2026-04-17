import React from 'react';
import { RiVolumeUpLine } from 'react-icons/ri';
import ContextLookupPopup from '@/components/ContextLookupPopup';
import { useContextTranslation } from '@/hooks/useContextTranslation';
import useOpenAIInNotebook from '@/app/reader/hooks/useOpenAIInNotebook';
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
import type { ContextTranslationSettings } from '@/services/contextTranslation/types';
import { getJapaneseGrammarHint } from '@/services/contextTranslation/grammarHints';
import { getFrequencyBadge } from '@/services/contextTranslation/frequencyService';
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
  bookLanguage?: string;
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
    aiUnavailable,
    retrievalStatus,
    retrievalHints,
    popupContext,
    examples,
    annotations,
    debugInfo,
    saveToVocabulary,
  } = useContextTranslation({
    bookKey,
    bookHash,
    selectedText: currentTerm,
    currentPage,
    settings,
    bookLanguage,
  });

  const source = settings.source ?? 'ai';

  // Map source key 鈫?display label for the "Translation" field header
  // Non-AI sources show "Translation (Source)" so the user knows which provider was used
  const sourceLabels: Record<string, string> = {
    ai: _('Translation'),
    dictionary: `${_('Translation')} (${_('Dictionary')})`,
  };

  const enabledFields = settings.outputFields
    .filter((field) => field.enabled)
    .sort((a, b) => a.order - b.order);
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

  // Deterministic grammar hint for Japanese (kuromoji POS analysis)
  const japaneseGrammarHint =
    sourceCJKLang === 'japanese' ? getJapaneseGrammarHint(currentTerm) : null;

  // Frequency / proficiency level badge
  const detectedLang =
    sourceCJKLang === 'chinese'
      ? 'zh'
      : sourceCJKLang === 'japanese'
        ? 'ja'
        : (bookLanguage ?? 'en');
  const frequencyBadge = getFrequencyBadge(currentTerm, detectedLang);

  const { speakOwnedText, stopOwnedSpeech } = usePopupOwnedTTS(bookKey);

  const handleSpeak = (text: string, lang?: string) => {
    speakOwnedText({ text, lang });
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
      onSpeakSelectedText={() => handleSpeak(currentTerm)}
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
      testId='context-translation-popup'
      maxWidth='600px'
    >
      {loading && !hasDisplayedResult && (
        <p className='text-sm italic text-gray-400'>{_('Translating...')}</p>
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
        <LookupDictionaryResults
          dictionaryResults={popupContext.dictionaryResults}
          selectedText={currentTerm}
          onNavigateTerm={pushTerm}
        />
      )}
      {!error &&
        (hasDisplayedResult || !loading) &&
        enabledFields.map((field) => {
          const value = displayedResult[field.id] ?? '';
          const isActive = streaming && activeFieldId === field.id;

          return (
            <div key={field.id}>
              <div className='mb-1 flex items-center gap-1'>
                <h3 className='text-xs font-medium uppercase tracking-wide text-gray-400'>
                  {field.id === 'translation'
                    ? (sourceLabels[source] ?? _(field.label))
                    : _(field.label)}
                </h3>
                {(field.id === 'translation' || field.id === 'contextualMeaning') && value && (
                  <button
                    data-testid={`tts-${field.id === 'contextualMeaning' ? 'contextual-meaning' : field.id}`}
                    onClick={() => handleSpeak(value, settings.targetLanguage)}
                    title={_('Speak')}
                    className='flex-shrink-0 text-green-200/70 transition-colors hover:text-green-100'
                  >
                    <RiVolumeUpLine size={14} />
                  </button>
                )}
              </div>
              {field.id === 'examples' && displayedExamples.length > 0 ? (
                <ol className='not-eink:text-white/90 select-text list-decimal space-y-4 pl-5 text-sm leading-relaxed'>
                  {displayedExamples.map((example, index) => {
                    const sourceLang = getCJKLanguage(
                      example.sourceText,
                      popupContext?.localPastContext ?? '',
                      bookLanguage,
                    );
                    const targetLang = getCJKLanguage(
                      example.targetText,
                      popupContext?.localPastContext ?? '',
                      bookLanguage,
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
      {developerMode && debugInfo && <LookupDebugSection debugInfo={debugInfo} />}
    </ContextLookupPopup>
  );
};

export default ContextTranslationPopup;
