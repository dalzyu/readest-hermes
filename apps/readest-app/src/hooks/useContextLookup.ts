import { useState, useEffect, useCallback, useMemo, useRef } from 'react';

import { DEFAULT_AI_SETTINGS } from '@/services/ai/constants';
import { getAIProvider } from '@/services/ai/providers';
import { buildPopupContextBundle } from '@/services/contextTranslation/popupRetrievalService';
import { streamTranslationWithContext } from '@/services/contextTranslation/translationService';
import type {
  ContextTranslationSettings,
  PopupContextBundle,
  PopupRetrievalHints,
  RetrievalStatus,
  TranslationResult,
  TranslationStreamResult,
} from '@/services/contextTranslation/types';
import { saveVocabularyEntry } from '@/services/contextTranslation/vocabularyService';
import { validateLookupResult } from '@/services/contextTranslation/validator';
import type { ValidationDecision } from '@/services/contextTranslation/validator';
import { useSettingsStore } from '@/store/settingsStore';

export interface UseContextLookupInput {
  mode: 'translation' | 'dictionary';
  bookKey: string;
  bookHash: string;
  selectedText: string;
  currentPage: number;
  settings: ContextTranslationSettings;
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
}: UseContextLookupInput): UseContextLookupResult {
  const { settings: appSettings } = useSettingsStore();
  const [result, setResult] = useState<TranslationResult | null>(null);
  const [partialResult, setPartialResult] = useState<TranslationResult | null>(null);
  const [loading, setLoading] = useState(false);
  const [streaming, setStreaming] = useState(false);
  const [activeFieldId, setActiveFieldId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [popupContext, setPopupContext] = useState<PopupContextBundle | null>(null);
  const [validationDecision, setValidationDecision] = useState<ValidationDecision | null>(null);
  const contextRef = useRef<string>('');

  const requestSnapshot = useMemo(
    () => ({
      currentPage,
      settings,
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

        if (mode === 'translation') {
          const model = getAIProvider(requestSnapshot.aiSettings).getModel();
          for await (const translated of streamTranslationWithContext(
            {
              selectedText,
              popupContext: bundle,
              targetLanguage: requestSnapshot.settings.targetLanguage,
              outputFields: requestSnapshot.settings.outputFields,
            },
            model,
            abortController.signal,
          )) {
            if (cancelled) return;

            const streamUpdate = translated as TranslationStreamResult;
            setLoading(false);
            setPartialResult(streamUpdate.fields);
            setActiveFieldId(streamUpdate.activeFieldId);
            setStreaming(!streamUpdate.done);

            if (streamUpdate.done) {
              setResult(streamUpdate.fields);
              const primaryField =
                requestSnapshot.settings.outputFields.find((f) => f.enabled)?.id ?? 'translation';
              const validation = validateLookupResult(
                streamUpdate.fields,
                primaryField,
                selectedText,
              );
              setValidationDecision(validation.decision);
            }
          }
        } else {
          // dictionary mode (v1): no streaming, could call runContextLookup in the future
          // For now just mark as not loading
          setLoading(false);
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
    await saveVocabularyEntry({
      bookHash,
      term: selectedText,
      context: contextRef.current,
      result,
    });
  }, [bookHash, selectedText, result]);

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
    saveToVocabulary,
  };
}
