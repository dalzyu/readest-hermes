import React from 'react';
import { RiVolumeUpLine } from 'react-icons/ri';
import ContextLookupPopup from '@/components/ContextLookupPopup';
import { eventDispatcher } from '@/utils/event';
import { useContextTranslation } from '@/hooks/useContextTranslation';
import useOpenAIInNotebook from '@/app/reader/hooks/useOpenAIInNotebook';
import { useTranslation } from '@/hooks/useTranslation';
import { useSettingsStore } from '@/store/settingsStore';
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

  const source = settings.source ?? 'ai';

  // Map source key 鈫?display label for the "Translation" field header
  // Non-AI sources show "Translation (Source)" so the user knows which provider was used
  const sourceLabels: Record<string, string> = {
    ai: _('Translation'),
    dictionary: `${_('Translation')} (${_('Dictionary')})`,
    azure: `${_('Translation')} (${_('Azure')})`,
    deepl: `${_('Translation')} (${_('DeepL')})`,
    google: `${_('Translation')} (${_('Google')})`,
    yandex: `${_('Translation')} (${_('Yandex')})`,
  };

  const enabledFields = settings.outputFields
    .filter((field) => field.enabled)
    .sort((a, b) => a.order - b.order);
  const displayedResult = result ?? partialResult ?? {};
  const hasDisplayedResult = Object.keys(displayedResult).length > 0;
  // Use plugin-enriched examples when available; otherwise parse from raw LLM text (during streaming too)
  const displayedExamples =
    result !== null && examples.length > 0
      ? examples
      : displayedResult['examples']
        ? filterRenderableExamples(
            parseStructuredExamples(displayedResult['examples']),
            selectedText,
          )
        : [];
  const sourceCJKLang = getCJKLanguage(selectedText, popupContext?.localPastContext ?? '');
  const selectedTextPinyin =
    annotations?.source?.phonetic ??
    (popupContext !== null && sourceCJKLang === 'chinese' ? getPinyinLabel(selectedText) : '');
  const retrievalStatusMeta = getRetrievalStatusMeta(retrievalStatus);
  const retrievalInfoText = buildRetrievalInfoText(retrievalStatus, retrievalHints);

  const handleSpeak = (text: string, lang?: string) => {
    eventDispatcher.dispatch('tts-speak', {
      bookKey,
      text,
      oneTime: true,
      ...(lang ? { lang } : {}),
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
    <ContextLookupPopup
      selectedText={selectedText}
      selectedTextPinyin={selectedTextPinyin}
      retrievalStatusMeta={retrievalStatusMeta}
      retrievalInfoText={retrievalInfoText}
      loading={loading}
      aiEnabled={aiEnabled}
      hasDisplayedResult={hasDisplayedResult}
      onSpeakSelectedText={() => handleSpeak(selectedText)}
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
      testId='context-translation-popup'
      maxWidth='600px'
    >
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
    </ContextLookupPopup>
  );
};

export default ContextTranslationPopup;
