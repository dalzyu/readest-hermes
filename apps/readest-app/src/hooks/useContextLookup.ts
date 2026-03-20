import { useState, useEffect, useCallback, useMemo, useRef } from 'react';

import { DEFAULT_AI_SETTINGS } from '@/services/ai/constants';
import { getAIProvider } from '@/services/ai/providers';
import { buildPopupContextBundle } from '@/services/contextTranslation/popupRetrievalService';
import { runContextLookup } from '@/services/contextTranslation/contextLookupService';
import { streamTranslationWithContext } from '@/services/contextTranslation/translationService';
import type { TranslationRequest } from '@/services/contextTranslation/types';
import type {
  LookupAnnotationSlots,
  LookupExample,
  ContextDictionarySettings,
  ContextTranslationSettings,
  PopupContextBundle,
  PopupRetrievalHints,
  RetrievalStatus,
  TranslationResult,
} from '@/services/contextTranslation/types';
import { saveVocabularyEntry } from '@/services/contextTranslation/vocabularyService';
import { detectLookupLanguage } from '@/services/contextTranslation/languagePolicy';
import type { ValidationDecision } from '@/services/contextTranslation/validator';
import { useSettingsStore } from '@/store/settingsStore';

export interface UseContextLookupInput {
  mode: 'translation' | 'dictionary';
  bookKey: string;
  bookHash: string;
  selectedText: string;
  currentPage: number;
  settings: ContextTranslationSettings;
  dictionarySettings?: ContextDictionarySettings;
}

export interface UseContextLookupResult {
  result: Record<string, string> | null;
  partialResult: Record<string, string> | null;
  loading: boolean;
  streaming: boolean;
  activeFieldId: string | null;
  error: string | null;
  validationDecision: ValidationDecision | null;
  retrievalStatus: RetrievalStatus;
  retrievalHints: PopupRetrievalHints;
  popupContext: PopupContextBundle | null;
  examples: LookupExample[];
  annotations: LookupAnnotationSlots | null;
  saveToVocabulary: () => Promise<void>;
}

const EMPTY_RETRIEVAL_HINTS: PopupRetrievalHints = {
  currentVolumeIndexed: false,
  missingLocalIndex: false,
  missingPriorVolumes: [],
  missingSeriesAssignment: false,
};

export function useContextLookup({
  mode,
  bookHash,
  selectedText,
  currentPage,
  settings,
  dictionarySettings,
}: UseContextLookupInput): UseContextLookupResult {
  const { settings: appSettings } = useSettingsStore();
  const [result, setResult] = useState<TranslationResult | null>(null);
  const [partialResult, setPartialResult] = useState<TranslationResult | null>(null);
  const [loading, setLoading] = useState(false);
  const [streaming, setStreaming] = useState(false);
  const [activeFieldId, setActiveFieldId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [popupContext, setPopupContext] = useState<PopupContextBundle | null>(null);
  const [examples, setExamples] = useState<LookupExample[]>([]);
  const [annotations, setAnnotations] = useState<LookupAnnotationSlots | null>(null);
  const [validationDecision, setValidationDecision] = useState<ValidationDecision | null>(null);
  const contextRef = useRef<string>('');

  const requestSnapshot = useMemo(
    () => ({
      currentPage,
      settings,
      dictionarySettings,
      aiSettings: appSettings?.aiSettings ?? DEFAULT_AI_SETTINGS,
    }),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [bookHash, selectedText],
  );

  useEffect(() => {
    if (!selectedText.trim()) return;

    let cancelled = false;
    const abortController = new AbortController();
    setLoading(true);
    setStreaming(false);
    setError(null);
    setResult(null);
    setPartialResult(null);
    setActiveFieldId(null);
    setPopupContext(null);
    setExamples([]);
    setAnnotations(null);
    setValidationDecision(null);

    const run = async () => {
      try {
        const bundle = await buildPopupContextBundle({
          bookHash,
          currentPage: requestSnapshot.currentPage,
          selectedText,
          settings: requestSnapshot.settings,
          aiSettings: requestSnapshot.aiSettings,
        });
        contextRef.current = bundle.localPastContext;

        if (cancelled) return;

        setPopupContext(bundle);

        const model = getAIProvider(requestSnapshot.aiSettings).getModel();

        if (mode === 'translation') {
          // Streaming path for translation mode — real-time UI updates + post-stream repair/enrichment
          setStreaming(true);

          const translationRequest: TranslationRequest = {
            selectedText,
            popupContext: bundle,
            sourceLanguage: undefined,
            targetLanguage: requestSnapshot.settings.targetLanguage,
            outputFields: requestSnapshot.settings.outputFields,
          };

          let finalRawText = '';
          let finalFields: TranslationResult = {};

          for await (const chunk of streamTranslationWithContext(
            translationRequest,
            model,
            abortController.signal,
          )) {
            if (cancelled) return;
            finalRawText = chunk.rawText;
            finalFields = chunk.fields;
            setPartialResult(chunk.fields);
            setActiveFieldId(chunk.activeFieldId);
          }

          if (cancelled) return;

          setStreaming(false);

          // Post-stream: repair (if needed) + enrichment + telemetry via runContextLookup
          const lookupResult = await runContextLookup({
            mode: 'translation',
            selectedText,
            popupContext: bundle,
            targetLanguage: requestSnapshot.settings.targetLanguage,
            outputFields: requestSnapshot.settings.outputFields,
            model,
            abortSignal: abortController.signal,
            preNormalizedFields: finalFields,
            rawResponse: finalRawText,
          });

          if (cancelled) return;

          setResult(lookupResult.fields);
          setExamples(lookupResult.examples ?? []);
          setAnnotations(lookupResult.annotations ?? {});
          setValidationDecision(lookupResult.validationDecision);
        } else {
          // Dictionary mode — non-streaming final-result-first
          const lookupResult = await runContextLookup({
            mode: 'dictionary',
            selectedText,
            popupContext: bundle,
            targetLanguage: requestSnapshot.settings.targetLanguage,
            outputFields: requestSnapshot.settings.outputFields,
            dictionarySettings: requestSnapshot.dictionarySettings,
            model,
            abortSignal: abortController.signal,
          });

          if (cancelled) return;

          setResult(lookupResult.fields);
          setExamples(lookupResult.examples ?? []);
          setAnnotations(lookupResult.annotations ?? {});
          setValidationDecision(lookupResult.validationDecision);
        }
      } catch (err) {
        if (!cancelled && (err as Error).name !== 'AbortError') {
          setError(err instanceof Error ? err.message : String(err));
        }
      } finally {
        if (!cancelled) {
          setLoading(false);
        }
      }
    };

    run();
    return () => {
      cancelled = true;
      abortController.abort();
    };
  }, [selectedText, bookHash, requestSnapshot, mode]);

  const saveToVocabulary = useCallback(async () => {
    if (!result) return;
    const detectedLanguage = detectLookupLanguage(selectedText);
    await saveVocabularyEntry({
      bookHash,
      term: selectedText,
      context: contextRef.current,
      result,
      mode,
      sourceLanguage: detectedLanguage.language,
      targetLanguage: mode === 'translation' ? settings.targetLanguage : undefined,
      examples: examples.map((example) => ({
        exampleId: example.exampleId,
        text: `${example.sourceText}\n${example.targetText}`,
      })),
    });
  }, [bookHash, examples, mode, result, selectedText, settings.targetLanguage]);

  return {
    result,
    partialResult,
    loading,
    streaming,
    activeFieldId,
    error,
    validationDecision,
    retrievalStatus: popupContext?.retrievalStatus ?? 'local-only',
    retrievalHints: popupContext?.retrievalHints ?? EMPTY_RETRIEVAL_HINTS,
    popupContext,
    examples,
    annotations,
    saveToVocabulary,
  };
}
