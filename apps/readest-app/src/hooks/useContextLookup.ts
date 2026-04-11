import { useState, useEffect, useCallback, useMemo, useRef } from 'react';

import { DEFAULT_AI_SETTINGS } from '@/services/ai/constants';

import { getAIProvider } from '@/services/ai/providers';
import { buildPopupContextBundle } from '@/services/contextTranslation/popupRetrievalService';
import { runContextLookup } from '@/services/contextTranslation/contextLookupService';
import { runSimpleLookup } from '@/services/contextTranslation/simpleLookup';
import type { TranslationSource } from '@/services/contextTranslation/simpleLookup';
import {
  streamTranslationWithContext,
  streamLookupWithContext,
} from '@/services/contextTranslation/translationService';
import type { ContextLookupMode } from '@/services/contextTranslation/modes';
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
import { saveLookupHistoryEntry } from '@/services/contextTranslation/lookupHistoryService';
import { detectLookupLanguage } from '@/services/contextTranslation/languagePolicy';
import type { ValidationDecision } from '@/services/contextTranslation/validator';
import { useSettingsStore } from '@/store/settingsStore';
import { eventDispatcher } from '@/utils/event';

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
  bookKey,
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
  const lookupHistoryKeyRef = useRef<string | null>(null);

  const requestSnapshot = useMemo(
    () => ({
      currentPage,
      settings,
      dictionarySettings,
      aiSettings: appSettings?.aiSettings ?? DEFAULT_AI_SETTINGS,
    }),
    [bookHash, selectedText, currentPage, settings, dictionarySettings, appSettings?.aiSettings],
  );

  useEffect(() => {
    if (!selectedText.trim()) return;

    lookupHistoryKeyRef.current = null;
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
          bookKey,
          bookHash,
          currentPage: requestSnapshot.currentPage,
          selectedText,
          settings: requestSnapshot.settings,
          aiSettings: requestSnapshot.aiSettings,
        });
        contextRef.current = bundle.localPastContext;

        if (cancelled) return;

        setPopupContext(bundle);

        // Pre-detect language so all paths (AI and non-AI) have accurate sourceLanguage
        const detectedLanguage = detectLookupLanguage(selectedText);

        // Route non-AI sources to simpleLookup
        const source: TranslationSource = requestSnapshot.settings.source ?? 'ai';

        if (source !== 'ai') {
          const simpleLookupRequest = {
            mode: 'translation' as const,
            selectedText,
            popupContext: bundle,
            sourceLanguage: detectedLanguage.language,
            targetLanguage: requestSnapshot.settings.targetLanguage,
            outputFields: requestSnapshot.settings.outputFields,
            disabledBundledDicts: requestSnapshot.settings.disabledBundledDicts ?? [],
          };
          const lookupResult = await runSimpleLookup(simpleLookupRequest, source);
          if (cancelled) return;
          setResult(lookupResult.fields);
          setExamples(lookupResult.examples ?? []);
          setAnnotations(lookupResult.annotations ?? {});
          setValidationDecision(lookupResult.validationDecision);
          setLoading(false);
          return;
        }

        const model = getAIProvider(requestSnapshot.aiSettings).getModel();

        if (mode === 'translation') {
          // Streaming path for translation mode — real-time UI updates + post-stream repair/enrichment
          setStreaming(true);

          const translationRequest: TranslationRequest = {
            selectedText,
            popupContext: bundle,
            sourceLanguage: detectedLanguage.language,
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

          // If streaming yielded no fields, call without preNormalizedFields to force a fresh LLM request
          const hasStreamingResult = Object.keys(finalFields).length > 0;

          // Post-stream: repair (if needed) + enrichment + telemetry via runContextLookup
          const lookupResult = await runContextLookup({
            mode: 'translation',
            selectedText,
            popupContext: bundle,
            sourceLanguage: detectedLanguage.language,
            targetLanguage: requestSnapshot.settings.targetLanguage,
            outputFields: requestSnapshot.settings.outputFields,
            model,
            abortSignal: abortController.signal,
            ...(hasStreamingResult
              ? { preNormalizedFields: finalFields, rawResponse: finalRawText }
              : {}),
          });

          if (cancelled) return;

          setResult(lookupResult.fields);
          setExamples(lookupResult.examples ?? []);
          setAnnotations(lookupResult.annotations ?? {});
          setValidationDecision(lookupResult.validationDecision);
        } else {
          // Dictionary mode — streaming with real-time partial results + post-stream repair/enrichment
          setStreaming(true);

          const dictionaryRequest = {
            selectedText,
            popupContext: bundle,
            sourceLanguage: detectedLanguage.language,
            targetLanguage: requestSnapshot.settings.targetLanguage,
            outputFields: requestSnapshot.settings.outputFields,
            dictionarySettings: requestSnapshot.dictionarySettings,
          } as TranslationRequest & { dictionarySettings?: ContextDictionarySettings };

          let finalRawText = '';
          let finalFields: TranslationResult = {};

          for await (const chunk of streamLookupWithContext(
            { ...dictionaryRequest, mode: 'dictionary' as ContextLookupMode },
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

          // If streaming yielded no fields, call without preNormalizedFields to force a fresh LLM request
          const hasStreamingResult = Object.keys(finalFields).length > 0;

          const lookupResult = await runContextLookup({
            mode: 'dictionary',
            selectedText,
            popupContext: bundle,
            sourceLanguage: detectedLanguage.language,
            targetLanguage: requestSnapshot.settings.targetLanguage,
            outputFields: requestSnapshot.settings.outputFields,
            dictionarySettings: requestSnapshot.dictionarySettings,
            model,
            abortSignal: abortController.signal,
            ...(hasStreamingResult
              ? { preNormalizedFields: finalFields, rawResponse: finalRawText }
              : {}),
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
  }, [selectedText, bookKey, bookHash, requestSnapshot, mode]);

  useEffect(() => {
    const term = selectedText.trim();
    if (
      !term ||
      !result ||
      loading ||
      streaming ||
      validationDecision !== 'accept' ||
      !Object.values(result).some((value) => value.trim().length > 0)
    ) {
      return;
    }

    const historyKey = JSON.stringify({
      bookHash,
      term,
      mode,
      result,
    });

    if (lookupHistoryKeyRef.current === historyKey) return;

    saveLookupHistoryEntry({
      bookHash,
      term,
      context: contextRef.current,
      result,
      mode,
    });
    void eventDispatcher.dispatch('lookup-history-updated', { bookHash });
    lookupHistoryKeyRef.current = historyKey;
  }, [bookHash, loading, mode, result, selectedText, streaming, validationDecision]);

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
