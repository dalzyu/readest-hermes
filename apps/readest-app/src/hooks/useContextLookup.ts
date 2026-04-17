import { useState, useEffect, useCallback, useMemo, useRef } from 'react';

import { DEFAULT_AI_SETTINGS } from '@/services/ai/constants';
import {
  DEFAULT_CONTEXT_DICTIONARY_SETTINGS,
  getContextDictionaryOutputFields,
} from '@/services/contextTranslation/defaults';
import { getProviderForTask } from '@/services/ai/providers';
import { setAIDebugEnabled } from '@/services/ai/logger';
import { buildPopupContextBundle } from '@/services/contextTranslation/popupRetrievalService';
import { consumePrefetch } from '@/services/contextTranslation/prefetchService';
import { runContextLookup } from '@/services/contextTranslation/contextLookupService';
import { runSimpleLookup } from '@/services/contextTranslation/simpleLookup';
import type { TranslationSource } from '@/services/contextTranslation/simpleLookup';
import {
  finalizeTranslationWithContext,
  streamTranslationWithContext,
  streamLookupWithContext,
  streamPerFieldTranslation,
} from '@/services/contextTranslation/translationService';
import { lookupDefinitions } from '@/services/contextTranslation/dictionaryService';
import {
  buildLookupPrompt,
  buildPerFieldPrompt,
  buildTranslationPrompt,
} from '@/services/contextTranslation/promptBuilder';
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
import { parseRenderableExampleField } from '@/services/contextTranslation/exampleFormatter';
import { saveVocabularyEntry } from '@/services/contextTranslation/vocabularyService';
import { saveLookupHistoryEntry } from '@/services/contextTranslation/lookupHistoryService';
import { detectLookupLanguage } from '@/services/contextTranslation/languagePolicy';
import { expandToWordBoundary } from '@/services/contextTranslation/selectionExpander';
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
  /** Book's primary language from epub metadata (e.g. 'en', 'ja'). Used as detection prior. */
  bookLanguage?: string;
}

export interface LookupDebugInfo {
  systemPrompt: string;
  userPrompt: string;
  rawStream: string;
  parsedResult: TranslationResult | null;
}

export interface UseContextLookupResult {
  result: Record<string, string> | null;
  partialResult: Record<string, string> | null;
  loading: boolean;
  streaming: boolean;
  activeFieldId: string | null;
  error: string | null;
  aiUnavailable: boolean;
  /** Text after word-boundary expansion (may differ from the raw selection). */
  expandedText: string | null;
  validationDecision: ValidationDecision | null;
  retrievalStatus: RetrievalStatus;
  retrievalHints: PopupRetrievalHints;
  popupContext: PopupContextBundle | null;
  examples: LookupExample[];
  annotations: LookupAnnotationSlots | null;
  debugInfo: LookupDebugInfo | null;
  saveToVocabulary: () => Promise<void>;
}

function buildTranslationDebugPrompts(request: TranslationRequest, useMultiField: boolean) {
  if (!useMultiField) {
    return buildTranslationPrompt(request);
  }

  const enabledFields = request.outputFields
    .filter((field) => field.enabled)
    .sort((a, b) => a.order - b.order);
  const prompts = enabledFields.map((field) => ({
    fieldId: field.id,
    ...buildPerFieldPrompt(field, request),
  }));

  return {
    systemPrompt: prompts
      .map((prompt) => `### ${prompt.fieldId}\n${prompt.systemPrompt}`)
      .join('\n\n'),
    userPrompt: prompts.map((prompt) => `### ${prompt.fieldId}\n${prompt.userPrompt}`).join('\n\n'),
  };
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
  bookLanguage,
}: UseContextLookupInput): UseContextLookupResult {
  const { settings: appSettings } = useSettingsStore();
  const developerMode = appSettings?.aiSettings?.developerMode ?? false;
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
  const [debugInfo, setDebugInfo] = useState<LookupDebugInfo | null>(null);
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
    setAIDebugEnabled(developerMode);
  }, [developerMode]);

  useEffect(() => {
    if (!selectedText.trim()) return;

    lookupHistoryKeyRef.current = null;
    let cancelled = false;
    const abortController = new AbortController();
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

    const run = async () => {
      try {
        // Optionally expand selection to word boundaries
        const autoExpand = requestSnapshot.settings.autoExpandSelection !== false;
        const lookupText = autoExpand ? expandToWordBoundary(selectedText, '') : selectedText;
        if (lookupText !== selectedText) {
          setExpandedText(lookupText);
        }

        // Pre-detect language so dictionary lookup can start concurrently with RAG
        const detectedLanguage = detectLookupLanguage(lookupText, bookLanguage);

        // Launch bundle building (with prefetch check) and dictionary lookup in parallel
        const dictEnabled = requestSnapshot.settings.referenceDictionaryEnabled !== false;

        const [bundle, rawDictEntries] = await Promise.all([
          consumePrefetch(bookHash, requestSnapshot.currentPage, lookupText).then(
            (prefetched) =>
              prefetched ??
              buildPopupContextBundle({
                bookKey,
                bookHash,
                currentPage: requestSnapshot.currentPage,
                selectedText: lookupText,
                settings: requestSnapshot.settings,
                aiSettings: requestSnapshot.aiSettings,
              }),
          ),
          dictEnabled
            ? lookupDefinitions(
                lookupText,
                detectedLanguage.language,
                requestSnapshot.settings.targetLanguage,
              ).catch(() => [] as Awaited<ReturnType<typeof lookupDefinitions>>)
            : Promise.resolve([] as Awaited<ReturnType<typeof lookupDefinitions>>),
        ]);

        // Build string entries for LLM prompt + structured results for display
        const dictionaryEntries = rawDictEntries.map((e) => `${e.headword}: ${e.definition}`);

        // Inject pre-resolved dictionary entries into the bundle
        bundle.dictionaryEntries = dictionaryEntries;
        bundle.dictionaryResults = rawDictEntries.map((e) => ({
          headword: e.headword,
          definition: e.definition,
          source: e.source ?? '',
        }));
        contextRef.current = bundle.localPastContext;

        if (cancelled) return;

        setPopupContext(bundle);

        // Route non-AI sources to simpleLookup
        const source: TranslationSource = requestSnapshot.settings.source ?? 'ai';

        if (source !== 'ai') {
          const simpleLookupRequest = {
            mode: 'translation' as const,
            selectedText: lookupText,
            popupContext: bundle,
            sourceLanguage: detectedLanguage.language,
            targetLanguage: requestSnapshot.settings.targetLanguage,
            outputFields: requestSnapshot.settings.outputFields,
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

        const taskType =
          mode === 'translation' ? ('translation' as const) : ('dictionary' as const);
        let provider: ReturnType<typeof getProviderForTask>['provider'];
        let modelId: string;
        let inferenceParams: ReturnType<typeof getProviderForTask>['inferenceParams'];
        try {
          ({ provider, modelId, inferenceParams } = getProviderForTask(
            requestSnapshot.aiSettings,
            taskType,
          ));
        } catch {
          // No AI provider configured — fall back to dictionary-only results
          if (cancelled) return;
          setAiUnavailable(true);
          setLoading(false);
          return;
        }
        const model = provider.getModel(modelId, inferenceParams);
        const hasDictionaryAiFields =
          mode !== 'dictionary' ||
          getContextDictionaryOutputFields(
            requestSnapshot.dictionarySettings ?? DEFAULT_CONTEXT_DICTIONARY_SETTINGS,
          ).some((field) => field.enabled);
        if (!hasDictionaryAiFields) {
          setLoading(false);
          return;
        }

        if (mode === 'translation') {
          // Streaming path for translation mode — real-time UI updates + post-stream repair/enrichment
          setStreaming(true);

          const translationRequest: TranslationRequest = {
            selectedText: lookupText,
            popupContext: bundle,
            sourceLanguage: detectedLanguage.language,
            targetLanguage: requestSnapshot.settings.targetLanguage,
            outputFields: requestSnapshot.settings.outputFields,
            inferenceParams,
          };

          let finalRawText = '';
          let finalFields: TranslationResult = {};

          // Choose streamer based on fieldStrategy
          const useMultiField = requestSnapshot.settings.fieldStrategy === 'multi';
          const streamer = useMultiField
            ? streamPerFieldTranslation(translationRequest, model, abortController.signal)
            : streamTranslationWithContext(translationRequest, model, abortController.signal);
          const debugPrompts = developerMode
            ? buildTranslationDebugPrompts(translationRequest, useMultiField)
            : null;
          if (debugPrompts) {
            setDebugInfo({
              systemPrompt: debugPrompts.systemPrompt,
              userPrompt: debugPrompts.userPrompt,
              rawStream: '',
              parsedResult: null,
            });
          }

          for await (const chunk of streamer) {
            if (cancelled) return;
            finalRawText = chunk.rawText;
            finalFields = chunk.fields;
            setPartialResult(chunk.fields);
            setExamples(
              parseRenderableExampleField(
                chunk.fields,
                lookupText,
                requestSnapshot.settings.targetLanguage,
                { allowIncomplete: true },
              ),
            );
            setActiveFieldId(chunk.activeFieldId);
            if (debugPrompts) {
              setDebugInfo({
                systemPrompt: debugPrompts.systemPrompt,
                userPrompt: debugPrompts.userPrompt,
                rawStream: finalRawText,
                parsedResult: chunk.fields,
              });
            }
          }

          if (cancelled) return;

          setStreaming(false);

          let finalizedFields = finalFields;
          let finalizedRawText = finalRawText;

          if (!useMultiField) {
            const finalized = await finalizeTranslationWithContext(
              {
                ...translationRequest,
                harness: requestSnapshot.settings.harness,
              },
              model,
              abortController.signal,
              Object.keys(finalFields).length > 0 || finalRawText
                ? {
                    initialRawText: finalRawText,
                    initialFields: finalFields,
                  }
                : undefined,
            );
            finalizedFields = finalized.fields;
            finalizedRawText = finalized.rawText;
          }

          // If streaming yielded no fields, call without preNormalizedFields to force a fresh LLM request
          const hasStreamingResult = Object.keys(finalizedFields).length > 0;

          // Post-stream: repair (if needed) + enrichment + telemetry via runContextLookup
          const lookupResult = await runContextLookup({
            mode: 'translation',
            selectedText: lookupText,
            popupContext: bundle,
            sourceLanguage: detectedLanguage.language,
            targetLanguage: requestSnapshot.settings.targetLanguage,
            outputFields: requestSnapshot.settings.outputFields,
            model,
            abortSignal: abortController.signal,
            preDictionaryEntries: dictionaryEntries,
            inferenceParams,
            ...(hasStreamingResult
              ? { preNormalizedFields: finalizedFields, rawResponse: finalizedRawText }
              : {}),
          });

          if (cancelled) return;

          setResult(lookupResult.fields);
          setExamples(lookupResult.examples ?? []);
          setAnnotations(lookupResult.annotations ?? {});
          setValidationDecision(lookupResult.validationDecision);
          if (debugPrompts) {
            setDebugInfo({
              systemPrompt: debugPrompts.systemPrompt,
              userPrompt: debugPrompts.userPrompt,
              rawStream: finalizedRawText,
              parsedResult: lookupResult.fields,
            });
          }
        } else {
          // Dictionary mode — streaming with real-time partial results + post-stream repair/enrichment
          setStreaming(true);

          const dictionaryRequest = {
            selectedText: lookupText,
            popupContext: bundle,
            sourceLanguage: detectedLanguage.language,
            targetLanguage: requestSnapshot.settings.targetLanguage,
            outputFields: requestSnapshot.settings.outputFields,
            dictionarySettings: requestSnapshot.dictionarySettings,
            inferenceParams,
          } as TranslationRequest & { dictionarySettings?: ContextDictionarySettings };
          const debugPrompts = developerMode
            ? buildLookupPrompt({
                ...dictionaryRequest,
                mode: 'dictionary' as ContextLookupMode,
                popupContext: bundle,
              })
            : null;
          if (debugPrompts) {
            setDebugInfo({
              systemPrompt: debugPrompts.systemPrompt,
              userPrompt: debugPrompts.userPrompt,
              rawStream: '',
              parsedResult: null,
            });
          }

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
            setExamples(
              parseRenderableExampleField(
                chunk.fields,
                lookupText,
                requestSnapshot.settings.targetLanguage,
                { allowIncomplete: true },
              ),
            );
            setActiveFieldId(chunk.activeFieldId);
            if (debugPrompts) {
              setDebugInfo({
                systemPrompt: debugPrompts.systemPrompt,
                userPrompt: debugPrompts.userPrompt,
                rawStream: finalRawText,
                parsedResult: chunk.fields,
              });
            }
          }

          if (cancelled) return;

          setStreaming(false);

          // If streaming yielded no fields, call without preNormalizedFields to force a fresh LLM request
          const hasStreamingResult = Object.keys(finalFields).length > 0;

          const lookupResult = await runContextLookup({
            mode: 'dictionary',
            selectedText: lookupText,
            popupContext: bundle,
            sourceLanguage: detectedLanguage.language,
            targetLanguage: requestSnapshot.settings.targetLanguage,
            outputFields: requestSnapshot.settings.outputFields,
            dictionarySettings: requestSnapshot.dictionarySettings,
            model,
            abortSignal: abortController.signal,
            preDictionaryEntries: dictionaryEntries,
            inferenceParams,
            ...(hasStreamingResult
              ? { preNormalizedFields: finalFields, rawResponse: finalRawText }
              : {}),
          });

          if (cancelled) return;

          setResult(lookupResult.fields);
          setExamples(lookupResult.examples ?? []);
          setAnnotations(lookupResult.annotations ?? {});
          setValidationDecision(lookupResult.validationDecision);
          if (debugPrompts) {
            setDebugInfo({
              systemPrompt: debugPrompts.systemPrompt,
              userPrompt: debugPrompts.userPrompt,
              rawStream: finalRawText,
              parsedResult: lookupResult.fields,
            });
          }
        }
      } catch (err) {
        if (!cancelled && (err as Error).name !== 'AbortError') {
          const message = err instanceof Error ? err.message : String(err);
          const isFetchFailure =
            err instanceof Error && (err.name === 'TypeError' || /fetch/i.test(message));
          if (isFetchFailure) {
            setAiUnavailable(true);
          } else {
            setError(message);
          }
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
  }, [bookHash, examples, expandedText, mode, result, selectedText, settings.targetLanguage]);

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
    saveToVocabulary,
  };
}
