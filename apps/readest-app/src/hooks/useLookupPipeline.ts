import { useCallback, useEffect, useMemo, useRef, useState } from 'react';

import { useAuth } from '@/context/AuthContext';
import { DEFAULT_AI_SETTINGS } from '@/services/ai/constants';
import { detectLookupLanguage } from '@/services/contextTranslation/languagePolicy';
import {
  runLookupPipeline,
  type LookupAvailabilityHint,
  type LookupFieldProvenance,
  type LookupPipelineDebugInfo,
} from '@/services/contextTranslation/lookupPipeline';
import { saveLookupHistoryEntry } from '@/services/contextTranslation/lookupHistoryService';
import { saveVocabularyEntry } from '@/services/contextTranslation/vocabularyService';
import type {
  ContextDictionarySettings,
  ContextTranslationSettings,
  LookupAnnotationSlots,
  LookupExample,
  PopupContextBundle,
  PopupRetrievalHints,
  RetrievalStatus,
  TranslationResult,
} from '@/services/contextTranslation/types';
import type { ValidationDecision } from '@/services/contextTranslation/validator';
import type { TranslatorName } from '@/services/translators/providers';
import { useSettingsStore } from '@/store/settingsStore';
import { eventDispatcher } from '@/utils/event';

export interface UseLookupPipelineInput {
  mode: 'translation' | 'dictionary';
  bookKey: string;
  bookHash: string;
  selectedText: string;
  currentPage: number;
  settings: ContextTranslationSettings;
  dictionarySettings?: ContextDictionarySettings;
  bookLanguage?: string;
  debounceMs?: number;
}

export interface UseLookupPipelineResult {
  result: TranslationResult | null;
  partialResult: TranslationResult | null;
  loading: boolean;
  streaming: boolean;
  activeFieldId: string | null;
  error: string | null;
  aiUnavailable: boolean;
  expandedText: string | null;
  validationDecision: ValidationDecision | null;
  retrievalStatus: RetrievalStatus;
  retrievalHints: PopupRetrievalHints;
  popupContext: PopupContextBundle | null;
  examples: LookupExample[];
  annotations: LookupAnnotationSlots | null;
  debugInfo: LookupPipelineDebugInfo | null;
  availabilityHint: LookupAvailabilityHint;
  fieldProvenance: LookupFieldProvenance | null;
  saveToVocabulary: () => Promise<void>;
}

const EMPTY_RETRIEVAL_HINTS: PopupRetrievalHints = {
  currentVolumeIndexed: false,
  missingLocalIndex: false,
  missingPriorVolumes: [],
  missingSeriesAssignment: false,
};

const KNOWN_TRANSLATORS: readonly TranslatorName[] = ['deepl', 'azure', 'google', 'yandex'];

function normalizeTranslationProvider(provider?: string): TranslatorName | undefined {
  if (!provider || provider === 'ai') return undefined;
  return KNOWN_TRANSLATORS.find((name) => name === provider);
}

export function useLookupPipeline({
  mode,
  bookKey,
  bookHash,
  selectedText,
  currentPage,
  settings,
  dictionarySettings,
  bookLanguage,
  debounceMs = 120,
}: UseLookupPipelineInput): UseLookupPipelineResult {
  const { settings: appSettings } = useSettingsStore();
  const { token } = useAuth();

  const [result, setResult] = useState<TranslationResult | null>(null);
  const [partialResult, setPartialResult] = useState<TranslationResult | null>(null);
  const [loading, setLoading] = useState(false);
  const [streaming, setStreaming] = useState(false);
  const [activeFieldId, setActiveFieldId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [aiUnavailable, setAiUnavailable] = useState(false);
  const [expandedText, setExpandedText] = useState<string | null>(null);
  const [popupContext, setPopupContext] = useState<PopupContextBundle | null>(null);
  const [examples, setExamples] = useState<LookupExample[]>([]);
  const [annotations, setAnnotations] = useState<LookupAnnotationSlots | null>(null);
  const [validationDecision, setValidationDecision] = useState<ValidationDecision | null>(null);
  const [debugInfo, setDebugInfo] = useState<LookupPipelineDebugInfo | null>(null);
  const [availabilityHint, setAvailabilityHint] = useState<LookupAvailabilityHint>(null);
  const [fieldProvenance, setFieldProvenance] = useState<LookupFieldProvenance | null>(null);

  const lookupHistoryKeyRef = useRef<string | null>(null);
  const contextRef = useRef<string>('');

  const requestSnapshot = useMemo(
    () => ({
      currentPage,
      settings,
      dictionarySettings,
      aiSettings: appSettings?.aiSettings ?? DEFAULT_AI_SETTINGS,
      translationProvider: normalizeTranslationProvider(
        appSettings?.globalReadSettings?.translationProvider ??
          (appSettings as { translationProvider?: string } | undefined)?.translationProvider,
      ),
      developerMode: appSettings?.aiSettings?.developerMode ?? false,
    }),
    [currentPage, settings, dictionarySettings, appSettings],
  );

  useEffect(() => {
    if (!selectedText.trim()) {
      setResult(null);
      setPartialResult(null);
      setLoading(false);
      setStreaming(false);
      setActiveFieldId(null);
      setError(null);
      setAiUnavailable(false);
      setExpandedText(null);
      setPopupContext(null);
      setExamples([]);
      setAnnotations(null);
      setValidationDecision(null);
      setDebugInfo(null);
      setAvailabilityHint(null);
      setFieldProvenance(null);
      return;
    }

    lookupHistoryKeyRef.current = null;

    let cancelled = false;
    const abortController = new AbortController();
    const timeoutId = setTimeout(() => {
      setLoading(true);
      setStreaming(false);
      setError(null);
      setAiUnavailable(false);
      setExpandedText(null);
      setResult(null);
      setPartialResult(null);
      setActiveFieldId(null);
      setPopupContext(null);
      setExamples([]);
      setAnnotations(null);
      setValidationDecision(null);
      setDebugInfo(null);
      setAvailabilityHint(null);
      setFieldProvenance(null);

      const run = async () => {
        try {
          const lookupResult = await runLookupPipeline(
            {
              mode,
              bookKey,
              bookHash,
              selectedText,
              currentPage: requestSnapshot.currentPage,
              settings: requestSnapshot.settings,
              dictionarySettings: requestSnapshot.dictionarySettings,
              aiSettings: requestSnapshot.aiSettings,
              bookLanguage,
              token,
              preferredTranslationProvider: requestSnapshot.translationProvider,
              developerMode: requestSnapshot.developerMode,
            },
            {
              signal: abortController.signal,
              onPartial: (partial) => {
                if (cancelled) return;
                setStreaming(true);
                setPartialResult(partial.fields);
                setActiveFieldId(partial.activeFieldId);
                setExamples(partial.examples);
                setFieldProvenance(partial.fieldProvenance);
                setDebugInfo(partial.debug);
              },
            },
          );

          if (cancelled) return;

          setStreaming(false);
          setResult(lookupResult.fields);
          setPartialResult((previous) => previous ?? lookupResult.fields);
          setActiveFieldId(null);
          setAiUnavailable(lookupResult.aiUnavailable);
          setExpandedText(lookupResult.expandedText);
          setPopupContext(lookupResult.popupContext);
          setExamples(lookupResult.examples);
          setAnnotations(lookupResult.annotations);
          setValidationDecision(lookupResult.validationDecision);
          setDebugInfo(lookupResult.debug);
          setAvailabilityHint(lookupResult.availabilityHint);
          setFieldProvenance(lookupResult.fieldProvenance);
          contextRef.current = lookupResult.popupContext.localPastContext;
        } catch (lookupError) {
          if (cancelled || (lookupError instanceof Error && lookupError.name === 'AbortError')) {
            return;
          }

          const message = lookupError instanceof Error ? lookupError.message : String(lookupError);
          setError(message);
        } finally {
          if (!cancelled) {
            setLoading(false);
          }
        }
      };

      void run();
    }, debounceMs);

    return () => {
      cancelled = true;
      clearTimeout(timeoutId);
      abortController.abort();
    };
  }, [
    selectedText,
    bookKey,
    bookHash,
    currentPage,
    mode,
    bookLanguage,
    token,
    debounceMs,
    requestSnapshot,
  ]);

  useEffect(() => {
    const term = (expandedText ?? selectedText).trim();

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

    if (lookupHistoryKeyRef.current === historyKey) {
      return;
    }

    saveLookupHistoryEntry({
      bookHash,
      term,
      context: contextRef.current,
      result,
      mode,
    });

    void eventDispatcher.dispatch('lookup-history-updated', { bookHash });
    lookupHistoryKeyRef.current = historyKey;
  }, [bookHash, expandedText, loading, mode, result, selectedText, streaming, validationDecision]);

  const saveToVocabulary = useCallback(async () => {
    if (!result) return;

    const vocabTerm = expandedText ?? selectedText;
    const detectedLanguage = detectLookupLanguage(vocabTerm, bookLanguage);

    await saveVocabularyEntry({
      bookHash,
      term: vocabTerm,
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
  }, [
    bookHash,
    bookLanguage,
    examples,
    expandedText,
    mode,
    result,
    selectedText,
    settings.targetLanguage,
  ]);

  return {
    result,
    partialResult,
    loading,
    streaming,
    activeFieldId,
    error,
    aiUnavailable,
    expandedText,
    validationDecision,
    retrievalStatus: popupContext?.retrievalStatus ?? 'local-only',
    retrievalHints: popupContext?.retrievalHints ?? EMPTY_RETRIEVAL_HINTS,
    popupContext,
    examples,
    annotations,
    debugInfo,
    availabilityHint,
    fieldProvenance,
    saveToVocabulary,
  };
}
