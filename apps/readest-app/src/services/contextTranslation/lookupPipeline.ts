import { getProviderForTask } from '@/services/ai/providers';
import type { AISettings } from '@/services/ai/types';
import type { BookDocType } from '@/services/ai/ragService';
import type { TranslatorName } from '@/services/translators/providers';
import { translateWithUpstream } from '@/services/translators/translateWithUpstream';

import {
  DEFAULT_CONTEXT_DICTIONARY_OUTPUT_FIELDS,
  DEFAULT_CONTEXT_DICTIONARY_SETTINGS,
  getContextDictionaryOutputFields,
} from './defaults';
import { lookupDefinitions } from './dictionaryService';
import { parseRenderableExampleField } from './exampleFormatter';
import { detectLookupLanguage, type DetectedLanguageInfo } from './languagePolicy';
import type { ContextLookupMode } from './modes';
import { buildLookupPrompt, buildPerFieldPrompt, buildTranslationPrompt } from './promptBuilder';
import { consumePrefetch } from './prefetchService';
import { buildPopupContextBundle } from './popupRetrievalService';
import { expandToWordBoundary } from './selectionExpander';
import {
  finalizeTranslationWithContext,
  streamLookupWithContext,
  streamPerFieldTranslation,
  streamTranslationWithContext,
} from './translationService';
import { detectAIAvailability, resolveFieldSources, type FieldSourceMap } from './sourceRouter';
import { runContextLookup } from './contextLookupService';
import { mineCorpusExamples } from './exampleMiner';
import type {
  ContextDictionarySettings,
  ContextTranslationSettings,
  FieldSource,
  LookupAnnotationSlots,
  LookupExample,
  PopupContextBundle,
  PopupRetrievalHints,
  RetrievalStatus,
  TranslationOutputField,
  TranslationRequest,
  TranslationResult,
} from './types';
import { validateLookupResult, type ValidationDecision } from './validator';

export type LookupAvailabilityHint =
  | 'ai-on'
  | 'ai-off-with-translator'
  | 'ai-off-empty'
  | 'ai-request-failed'
  | 'partial-no-ai'
  | null;

export type LookupFieldProvenance = Record<string, FieldSource | 'aiUnavailable' | 'empty'>;

export interface LookupPipelineDebugInfo {
  systemPrompt: string;
  userPrompt: string;
  rawStream: string;
  parsedResult: TranslationResult | null;
}

export interface LookupPipelinePartial {
  fields: TranslationResult;
  activeFieldId: string | null;
  examples: LookupExample[];
  fieldProvenance: LookupFieldProvenance;
  debug: LookupPipelineDebugInfo | null;
}

export interface LookupPipelineResult {
  fields: TranslationResult;
  fieldProvenance: LookupFieldProvenance;
  examples: LookupExample[];
  annotations: LookupAnnotationSlots;
  validationDecision: ValidationDecision;
  detectedLanguage: DetectedLanguageInfo;
  availabilityHint: LookupAvailabilityHint;
  popupContext: PopupContextBundle;
  retrievalStatus: RetrievalStatus;
  retrievalHints: PopupRetrievalHints;
  expandedText: string | null;
  aiUnavailable: boolean;
  debug: LookupPipelineDebugInfo | null;
}

export interface LookupPipelineRequest {
  mode: ContextLookupMode;
  bookKey: string;
  bookHash: string;
  selectedText: string;
  currentPage: number;
  settings: ContextTranslationSettings;
  dictionarySettings?: ContextDictionarySettings;
  aiSettings: AISettings;
  bookLanguage?: string;
  token?: string | null;
  preferredTranslationProvider?: TranslatorName;
  bookDoc?: BookDocType | null;
  developerMode?: boolean;
}

export interface RunLookupPipelineOptions {
  onPartial?: (partial: LookupPipelinePartial) => void;
  signal?: AbortSignal;
}

const EMPTY_RETRIEVAL_HINTS: PopupRetrievalHints = {
  currentVolumeIndexed: false,
  missingLocalIndex: false,
  missingPriorVolumes: [],
  missingSeriesAssignment: false,
};

const KNOWN_TRANSLATORS: readonly TranslatorName[] = ['deepl', 'azure', 'google', 'yandex'];

function resolvePreferredTranslator(request: LookupPipelineRequest): TranslatorName | undefined {
  if (request.preferredTranslationProvider) {
    return request.preferredTranslationProvider;
  }

  const settingsProvider = (
    request.settings as ContextTranslationSettings & {
      translationProvider?: string;
    }
  ).translationProvider;

  if (!settingsProvider || settingsProvider === 'ai') {
    return undefined;
  }

  return KNOWN_TRANSLATORS.find((name) => name === settingsProvider);
}

function buildExamplesFieldValue(sentences: string[]): string {
  return sentences.map((sentence, index) => `${index + 1}. ${sentence}`).join('\n\n');
}

function buildTranslationDebugPrompts(
  request: TranslationRequest,
  useMultiField: boolean,
): { systemPrompt: string; userPrompt: string } {
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

function getRequestedOutputFields(
  mode: ContextLookupMode,
  settings: ContextTranslationSettings,
  dictionarySettings: ContextDictionarySettings,
): TranslationOutputField[] {
  if (mode === 'translation') {
    return settings.outputFields;
  }

  return DEFAULT_CONTEXT_DICTIONARY_OUTPUT_FIELDS.map((field) => ({
    ...field,
    enabled: field.id === 'sourceExamples' ? dictionarySettings.sourceExamples : true,
    promptInstruction: dictionarySettings.promptInstructions?.[field.id] ?? field.promptInstruction,
  }));
}

function getFieldSource(fieldSources: FieldSourceMap, fieldId: string): FieldSource {
  return fieldSources[fieldId] ?? 'ai';
}

function computeExamples(
  mode: ContextLookupMode,
  fields: TranslationResult,
  selectedText: string,
  targetLanguage: string,
): LookupExample[] {
  return parseRenderableExampleField(
    fields,
    selectedText,
    targetLanguage,
    mode === 'dictionary' ? { allowIncomplete: true } : { allowIncomplete: true },
  );
}

function mergeAiFields(
  baseFields: TranslationResult,
  aiFields: TranslationResult,
): TranslationResult {
  const merged: TranslationResult = { ...baseFields };

  for (const [fieldId, value] of Object.entries(aiFields)) {
    if (!value.trim()) continue;
    if (merged[fieldId]?.trim()) continue;
    merged[fieldId] = value;
  }

  return merged;
}

function finalizeFieldProvenance(
  requestedFieldIds: string[],
  fields: TranslationResult,
  fieldProvenance: LookupFieldProvenance,
): LookupFieldProvenance {
  const finalized: LookupFieldProvenance = { ...fieldProvenance };

  for (const fieldId of requestedFieldIds) {
    if (finalized[fieldId]) continue;
    finalized[fieldId] = fields[fieldId]?.trim() ? 'empty' : 'empty';
  }

  return finalized;
}

function determineAvailabilityHint(input: {
  aiAttempted: boolean;
  aiFailed: boolean;
  aiUnavailable: boolean;
  requestedFieldIds: string[];
  fields: TranslationResult;
  fieldProvenance: LookupFieldProvenance;
}): LookupAvailabilityHint {
  if (input.aiFailed) {
    return 'ai-request-failed';
  }

  const hasFilledField = input.requestedFieldIds.some((fieldId) => input.fields[fieldId]?.trim());
  const hasTranslatorTranslation = input.fieldProvenance['translation'] === 'translator';

  if (!input.aiAttempted && input.aiUnavailable) {
    if (!hasFilledField) {
      return 'ai-off-empty';
    }

    if (hasTranslatorTranslation) {
      return 'ai-off-with-translator';
    }

    return 'partial-no-ai';
  }

  if (input.aiAttempted) {
    const aiUnavailableFieldExists = input.requestedFieldIds.some(
      (fieldId) => input.fieldProvenance[fieldId] === 'aiUnavailable',
    );

    return aiUnavailableFieldExists ? 'partial-no-ai' : 'ai-on';
  }

  if (!hasFilledField) {
    return 'ai-off-empty';
  }

  if (hasTranslatorTranslation) {
    return 'ai-off-with-translator';
  }

  return null;
}

function resolvePrimaryField(
  outputFields: TranslationOutputField[],
  mode: ContextLookupMode,
): string {
  return (
    outputFields.find((field) => field.enabled)?.id ??
    (mode === 'dictionary' ? 'simpleDefinition' : 'translation')
  );
}

function createBaseResult(input: {
  mode: ContextLookupMode;
  selectedText: string;
  targetLanguage: string;
  outputFields: TranslationOutputField[];
  fields: TranslationResult;
  fieldProvenance: LookupFieldProvenance;
  detectedLanguage: DetectedLanguageInfo;
  popupContext: PopupContextBundle;
  availabilityHint: LookupAvailabilityHint;
  aiUnavailable: boolean;
  debug: LookupPipelineDebugInfo | null;
  annotations?: LookupAnnotationSlots;
}): LookupPipelineResult {
  const primaryField = resolvePrimaryField(input.outputFields, input.mode);
  const validationDecision = validateLookupResult(
    input.fields,
    primaryField,
    input.selectedText,
    input.detectedLanguage.language,
    input.targetLanguage,
  ).decision;

  return {
    fields: input.fields,
    fieldProvenance: input.fieldProvenance,
    examples: computeExamples(input.mode, input.fields, input.selectedText, input.targetLanguage),
    annotations: input.annotations ?? {},
    validationDecision,
    detectedLanguage: input.detectedLanguage,
    availabilityHint: input.availabilityHint,
    popupContext: input.popupContext,
    retrievalStatus: input.popupContext.retrievalStatus,
    retrievalHints: input.popupContext.retrievalHints,
    expandedText: null,
    aiUnavailable: input.aiUnavailable,
    debug: input.debug,
  };
}

export async function runLookupPipeline(
  request: LookupPipelineRequest,
  options: RunLookupPipelineOptions = {},
): Promise<LookupPipelineResult> {
  const selectedText = request.selectedText.trim();
  if (!selectedText) {
    const emptyContext: PopupContextBundle = {
      localPastContext: '',
      localFutureBuffer: '',
      sameBookChunks: [],
      priorVolumeChunks: [],
      dictionaryEntries: [],
      retrievalStatus: 'local-only',
      retrievalHints: EMPTY_RETRIEVAL_HINTS,
      dictionaryResults: [],
    };

    return createBaseResult({
      mode: request.mode,
      selectedText: '',
      targetLanguage: request.settings.targetLanguage,
      outputFields: [],
      fields: {},
      fieldProvenance: {},
      detectedLanguage: detectLookupLanguage('', request.bookLanguage),
      popupContext: emptyContext,
      availabilityHint: null,
      aiUnavailable: false,
      debug: null,
    });
  }

  const dictionarySettings = request.dictionarySettings ?? DEFAULT_CONTEXT_DICTIONARY_SETTINGS;
  const outputFields = getRequestedOutputFields(request.mode, request.settings, dictionarySettings);
  const requestedFieldIds = outputFields.filter((field) => field.enabled).map((field) => field.id);

  let lookupText = selectedText;
  let expandedText: string | null = null;
  let detectedLanguage = detectLookupLanguage(lookupText, request.bookLanguage);

  const shouldLookupDictionary =
    request.mode === 'dictionary' || request.settings.referenceDictionaryEnabled !== false;

  const fetchBundleAndDictionary = async (
    term: string,
    sourceLanguage: string,
  ): Promise<{
    bundle: PopupContextBundle;
    dictionaryResults: Awaited<ReturnType<typeof lookupDefinitions>>;
    referenceDictionaryResults: Awaited<ReturnType<typeof lookupDefinitions>>;
  }> => {
    const [bundle, dictionaryResults, referenceDictionaryResults] = await Promise.all([
      consumePrefetch(request.bookHash, request.currentPage, term).then((prefetched) => {
        if (prefetched) {
          return prefetched;
        }

        return buildPopupContextBundle({
          bookKey: request.bookKey,
          bookHash: request.bookHash,
          currentPage: request.currentPage,
          selectedText: term,
          settings: request.settings,
          aiSettings: request.aiSettings,
        });
      }),
      shouldLookupDictionary
        ? lookupDefinitions(term, sourceLanguage, request.settings.targetLanguage).catch(
            () => [] as Awaited<ReturnType<typeof lookupDefinitions>>,
          )
        : Promise.resolve([] as Awaited<ReturnType<typeof lookupDefinitions>>),
      shouldLookupDictionary
        ? lookupDefinitions(term, sourceLanguage, request.settings.targetLanguage, {
            maxMatchTier: 1,
          }).catch(() => [] as Awaited<ReturnType<typeof lookupDefinitions>>)
        : Promise.resolve([] as Awaited<ReturnType<typeof lookupDefinitions>>),
    ]);

    return {
      bundle,
      dictionaryResults,
      referenceDictionaryResults,
    };
  };

  let {
    bundle: popupContext,
    dictionaryResults,
    referenceDictionaryResults,
  } = await fetchBundleAndDictionary(lookupText, detectedLanguage.language);

  if (request.settings.autoExpandSelection !== false) {
    const expansionContext = [
      popupContext.localPastContext,
      lookupText,
      popupContext.localFutureBuffer,
    ]
      .filter(Boolean)
      .join('\n');
    const expanded = expandToWordBoundary(lookupText, expansionContext);

    if (expanded !== lookupText) {
      expandedText = expanded;
      lookupText = expanded;
      detectedLanguage = detectLookupLanguage(lookupText, request.bookLanguage);
      ({
        bundle: popupContext,
        dictionaryResults,
        referenceDictionaryResults,
      } = await fetchBundleAndDictionary(lookupText, detectedLanguage.language));
    }
  }

  const dictionaryEntries = referenceDictionaryResults.map(
    (entry) => `${entry.headword}: ${entry.definition}`,
  );
  popupContext = {
    ...popupContext,
    dictionaryEntries,
    dictionaryResults: dictionaryResults.map((entry) => ({
      headword: entry.headword,
      definition: entry.definition,
      source: entry.source ?? '',
    })),
  };

  const availability = detectAIAvailability(request.aiSettings);
  const resolvedSources = resolveFieldSources(
    request.mode,
    request.settings,
    dictionarySettings,
    availability,
  );

  const fields: TranslationResult = {};
  const fieldProvenance: LookupFieldProvenance = {};

  const dictionaryDefinitionText = dictionaryResults
    .map((entry) => entry.definition.trim())
    .filter(Boolean)
    .join('\n');
  const dictionaryReferenceText = dictionaryResults
    .map((entry) => `${entry.headword}: ${entry.definition}`.trim())
    .filter(Boolean)
    .join('\n');

  for (const fieldId of requestedFieldIds) {
    if (getFieldSource(resolvedSources, fieldId) !== 'dictionary') {
      continue;
    }

    const dictionaryValue =
      request.mode === 'dictionary' ? dictionaryDefinitionText : dictionaryReferenceText;

    if (!dictionaryValue.trim()) {
      continue;
    }

    if (fieldId === 'sourceExamples' || fieldId === 'examples') {
      continue;
    }

    fields[fieldId] = dictionaryValue;
    fieldProvenance[fieldId] = 'dictionary';
  }

  if (
    requestedFieldIds.includes('translation') &&
    getFieldSource(resolvedSources, 'translation') === 'translator'
  ) {
    const translated = await translateWithUpstream({
      text: lookupText,
      sourceLang: detectedLanguage.language,
      targetLang: request.settings.targetLanguage,
      preferred: resolvePreferredTranslator(request),
      token: request.token,
      useCache: true,
    });

    if (translated.text.trim()) {
      fields['translation'] = translated.text.trim();
      fieldProvenance['translation'] = 'translator';
    }
  }

  const corpusFieldIds = requestedFieldIds.filter(
    (fieldId) => getFieldSource(resolvedSources, fieldId) === 'corpus',
  );

  if (corpusFieldIds.length > 0) {
    const corpusExamples = await mineCorpusExamples({
      bookKey: request.bookKey,
      bookHash: request.bookHash,
      bookDoc: request.bookDoc,
      term: lookupText,
      baseForm: dictionaryResults[0]?.headword,
      topN: 2,
      maxPage: request.currentPage,
      localPastContext: popupContext.localPastContext,
      localFutureBuffer: popupContext.localFutureBuffer,
    });

    if (corpusExamples.length > 0) {
      const examplesFieldValue = buildExamplesFieldValue(corpusExamples);
      for (const fieldId of corpusFieldIds) {
        fields[fieldId] = examplesFieldValue;
        fieldProvenance[fieldId] = 'corpus';
      }
    }
  }

  options.onPartial?.({
    fields: { ...fields },
    activeFieldId: null,
    examples: computeExamples(request.mode, fields, lookupText, request.settings.targetLanguage),
    fieldProvenance: finalizeFieldProvenance(requestedFieldIds, fields, fieldProvenance),
    debug: null,
  });

  const aiFieldIds = requestedFieldIds.filter(
    (fieldId) => getFieldSource(resolvedSources, fieldId) === 'ai',
  );

  const aiSettingsUnavailable = !availability.chat;
  const aiTaskType = request.mode === 'dictionary' ? 'dictionary' : 'translation';

  let aiAttempted = false;
  let aiFailed = false;
  let debug: LookupPipelineDebugInfo | null = null;
  let annotations: LookupAnnotationSlots = {};

  if (aiFieldIds.length > 0 && !aiSettingsUnavailable) {
    let model: ReturnType<ReturnType<typeof getProviderForTask>['provider']['getModel']>;
    let inferenceParams: ReturnType<typeof getProviderForTask>['inferenceParams'];

    try {
      const selection = getProviderForTask(request.aiSettings, aiTaskType);
      model = selection.provider.getModel(selection.modelId, selection.inferenceParams);
      inferenceParams = selection.inferenceParams;
      aiAttempted = true;

      const aiOutputFields =
        request.mode === 'dictionary'
          ? getContextDictionaryOutputFields(dictionarySettings).filter((field) =>
              aiFieldIds.includes(field.id),
            )
          : request.settings.outputFields.filter(
              (field) => field.enabled && aiFieldIds.includes(field.id),
            );

      if (aiOutputFields.length > 0) {
        const lookupRequest: TranslationRequest = {
          selectedText: lookupText,
          popupContext,
          sourceLanguage: detectedLanguage.language,
          targetLanguage: request.settings.targetLanguage,
          outputFields: aiOutputFields,
          inferenceParams,
          systemPromptTemplate:
            request.mode === 'dictionary'
              ? dictionarySettings.systemPromptTemplate
              : request.settings.systemPromptTemplate,
        };

        const debugPrompts = request.developerMode
          ? request.mode === 'translation'
            ? buildTranslationDebugPrompts(
                lookupRequest,
                request.settings.fieldStrategy === 'multi',
              )
            : buildLookupPrompt({
                mode: 'dictionary',
                selectedText: lookupText,
                popupContext,
                sourceLanguage: detectedLanguage.language,
                targetLanguage: request.settings.targetLanguage,
                outputFields: aiOutputFields,
                dictionarySettings,
                systemPromptTemplate: dictionarySettings.systemPromptTemplate,
              })
          : null;

        if (debugPrompts) {
          debug = {
            systemPrompt: debugPrompts.systemPrompt,
            userPrompt: debugPrompts.userPrompt,
            rawStream: '',
            parsedResult: null,
          };
        }

        let streamedFields: TranslationResult = {};
        let streamedRawText = '';

        if (request.mode === 'translation') {
          const useMultiField = request.settings.fieldStrategy === 'multi';
          const streamer = useMultiField
            ? streamPerFieldTranslation(lookupRequest, model, options.signal)
            : streamTranslationWithContext(lookupRequest, model, options.signal);

          for await (const chunk of streamer) {
            streamedFields = chunk.fields;
            streamedRawText = chunk.rawText;

            const partialFields = mergeAiFields(fields, chunk.fields);
            const partialProvenance = { ...fieldProvenance };
            for (const fieldId of aiFieldIds) {
              if (partialFields[fieldId]?.trim() && !partialProvenance[fieldId]) {
                partialProvenance[fieldId] = 'ai';
              }
            }

            if (debugPrompts) {
              debug = {
                systemPrompt: debugPrompts.systemPrompt,
                userPrompt: debugPrompts.userPrompt,
                rawStream: streamedRawText,
                parsedResult: chunk.fields,
              };
            }

            options.onPartial?.({
              fields: partialFields,
              activeFieldId: chunk.activeFieldId,
              examples: computeExamples(
                request.mode,
                partialFields,
                lookupText,
                request.settings.targetLanguage,
              ),
              fieldProvenance: finalizeFieldProvenance(
                requestedFieldIds,
                partialFields,
                partialProvenance,
              ),
              debug,
            });
          }

          if (!useMultiField) {
            const finalized = await finalizeTranslationWithContext(
              {
                ...lookupRequest,
                harness: request.settings.harness,
              },
              model,
              options.signal,
              Object.keys(streamedFields).length > 0 || streamedRawText
                ? {
                    initialRawText: streamedRawText,
                    initialFields: streamedFields,
                  }
                : undefined,
            );

            streamedFields = finalized.fields;
            streamedRawText = finalized.rawText;
          }
        } else {
          const streamer = streamLookupWithContext(
            {
              ...lookupRequest,
              mode: 'dictionary',
              dictionarySettings,
            },
            model,
            options.signal,
          );

          for await (const chunk of streamer) {
            streamedRawText = chunk.rawText;
            if (Object.values(chunk.fields).some((value) => value.trim().length > 0)) {
              streamedFields = chunk.fields;
            }

            const partialFields = mergeAiFields(fields, streamedFields);
            const partialProvenance = { ...fieldProvenance };
            for (const fieldId of aiFieldIds) {
              if (partialFields[fieldId]?.trim() && !partialProvenance[fieldId]) {
                partialProvenance[fieldId] = 'ai';
              }
            }

            if (debugPrompts) {
              debug = {
                systemPrompt: debugPrompts.systemPrompt,
                userPrompt: debugPrompts.userPrompt,
                rawStream: streamedRawText,
                parsedResult: Object.keys(streamedFields).length ? streamedFields : null,
              };
            }

            options.onPartial?.({
              fields: partialFields,
              activeFieldId: chunk.activeFieldId,
              examples: computeExamples(
                request.mode,
                partialFields,
                lookupText,
                request.settings.targetLanguage,
              ),
              fieldProvenance: finalizeFieldProvenance(
                requestedFieldIds,
                partialFields,
                partialProvenance,
              ),
              debug,
            });
          }
        }

        const lookupResult = await runContextLookup({
          mode: request.mode,
          selectedText: lookupText,
          popupContext,
          sourceLanguage: detectedLanguage.language,
          targetLanguage: request.settings.targetLanguage,
          outputFields: aiOutputFields,
          dictionarySettings,
          model,
          abortSignal: options.signal,
          preDictionaryEntries: dictionaryEntries,
          inferenceParams,
          systemPromptTemplate:
            request.mode === 'dictionary'
              ? dictionarySettings.systemPromptTemplate
              : request.settings.systemPromptTemplate,
          ...(Object.keys(streamedFields).length > 0 || streamedRawText
            ? {
                preNormalizedFields: streamedFields,
                rawResponse: streamedRawText,
              }
            : {}),
        });

        const mergedFields = mergeAiFields(fields, lookupResult.fields);
        for (const fieldId of aiFieldIds) {
          if (mergedFields[fieldId]?.trim() && !fieldProvenance[fieldId]) {
            fieldProvenance[fieldId] = 'ai';
          }
        }

        if (debugPrompts) {
          debug = {
            systemPrompt: debugPrompts.systemPrompt,
            userPrompt: debugPrompts.userPrompt,
            rawStream: streamedRawText,
            parsedResult: lookupResult.fields,
          };
        }

        Object.assign(fields, mergedFields);
        annotations = lookupResult.annotations;
      }
    } catch (error) {
      if (error instanceof Error && error.name === 'AbortError') {
        throw error;
      }
      aiFailed = true;
    }
  }

  for (const fieldId of aiFieldIds) {
    if (!fields[fieldId]?.trim() && !fieldProvenance[fieldId]) {
      fieldProvenance[fieldId] = aiFailed
        ? 'aiUnavailable'
        : aiSettingsUnavailable
          ? 'aiUnavailable'
          : 'empty';
    }
  }

  const finalizedProvenance = finalizeFieldProvenance(requestedFieldIds, fields, fieldProvenance);
  const availabilityHint = determineAvailabilityHint({
    aiAttempted,
    aiFailed,
    aiUnavailable: aiSettingsUnavailable,
    requestedFieldIds,
    fields,
    fieldProvenance: finalizedProvenance,
  });

  const result = createBaseResult({
    mode: request.mode,
    selectedText: lookupText,
    targetLanguage: request.settings.targetLanguage,
    outputFields,
    fields,
    fieldProvenance: finalizedProvenance,
    detectedLanguage,
    popupContext,
    availabilityHint,
    aiUnavailable:
      aiFailed ||
      (aiSettingsUnavailable && aiFieldIds.length > 0) ||
      finalizedProvenance['translation'] === 'aiUnavailable',
    debug,
    annotations,
  });

  result.expandedText = expandedText;
  return result;
}
