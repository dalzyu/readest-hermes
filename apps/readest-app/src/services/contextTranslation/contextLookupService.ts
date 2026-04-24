import type { LanguageModel } from 'ai';
import type { ContextLookupMode } from './modes';
import type {
  ContextDictionarySettings,
  LookupAnnotationSlots,
  LookupExample,
  InferenceParams,
  TranslationOutputField,
  PopupContextBundle,
  UserDictionary,
} from './types';
import type { NormalizedLookupResult } from './normalizer';
import type { DetectedLanguageInfo } from './languagePolicy';
import type { ValidationDecision } from './validator';
import { captureEvent } from '@/utils/telemetry';
import { detectLookupLanguage } from './languagePolicy';
import { resolveLookupPlugins } from './plugins/registry';
import { formatEnabledLookupResult, parseRenderableExampleField } from './exampleFormatter';

import { buildLookupPrompt } from './promptBuilder';
import { buildRepairPrompt } from './repairPromptBuilder';
import { callLLM } from './llmClient';
import { normalizeLookupResponse } from './normalizer';
import { validateLookupResult } from './validator';
import { lookupDefinitions } from './dictionaryService';
import { DEFAULT_CONTEXT_DICTIONARY_SETTINGS, getContextDictionaryOutputFields } from './defaults';

export interface ContextLookupRequest {
  mode: ContextLookupMode;
  selectedText: string;
  popupContext: PopupContextBundle;
  targetLanguage: string;
  sourceLanguage?: string;
  outputFields: TranslationOutputField[];
  dictionarySettings?: ContextDictionarySettings;
  systemPromptTemplate?: string;

  model?: LanguageModel;
  abortSignal?: AbortSignal;
  inferenceParams?: InferenceParams;
  /**
   * When provided, the LLM call is skipped and these pre-normalized fields are used
   * directly for validation/repair/enrichment. Used for post-streaming repair.
   */
  preNormalizedFields?: NormalizedLookupResult;
  /** The raw LLM response corresponding to preNormalizedFields. Required when preNormalizedFields is set. */
  rawResponse?: string;
  /** Pre-resolved dictionary entries to inject into the context. Skips the internal lookupDefinitions call. */
  preDictionaryEntries?: string[];
  /** Pre-resolved user dictionary metadata. Skips the internal getUserDictionaryMeta call. */
  userDictionaryMeta?: UserDictionary[];
}

export interface ContextLookupResult {
  fields: NormalizedLookupResult;
  examples: LookupExample[];
  annotations: LookupAnnotationSlots;
  validationDecision: ValidationDecision;
  detectedLanguage: DetectedLanguageInfo;
}

export type ContextLookupDegradationPath =
  | 'none'
  | 'repair-recovered'
  | 'repair-failed'
  | 'stream-final-degrade';

export interface ContextLookupTelemetryPayload {
  mode: ContextLookupMode;
  decision: ValidationDecision;
  repairCount: number;
  degradationPath: ContextLookupDegradationPath;
  sourceLanguage: string;
  targetLanguage: string;
  detectedLanguage: string;
  detectionConfidence: number;
  mixed: boolean;
  sourcePlugin: string;
  targetPlugin: string;
  structuredOutput: boolean;
  selectedTextLength: number;
}

export const CONTEXT_LOOKUP_EVENT = 'context_lookup_outcome';

export const CONTEXT_LOOKUP_ROLLOUT = {
  telemetryEnabled: true,
  repairOnDegrade: true,
};

export const contextLookupTelemetry = {
  logOutcome(payload: ContextLookupTelemetryPayload): void {
    if (!CONTEXT_LOOKUP_ROLLOUT.telemetryEnabled) {
      return;
    }

    captureEvent(CONTEXT_LOOKUP_EVENT, payload as unknown as Record<string, unknown>);
  },
};

function resolvePrimaryField(outputFields: TranslationOutputField[]): string {
  return outputFields.find((field) => field.enabled)?.id ?? 'translation';
}

/**
 * Returns the output fields to use for a lookup request, based on the mode.
 * In dictionary mode, this overrides the request's outputFields with the
 * dictionary-mode field definitions so the prompt and validation are consistent.
 */
function resolveEffectiveOutputFields(request: ContextLookupRequest): TranslationOutputField[] {
  if (request.mode === 'dictionary') {
    return getContextDictionaryOutputFields(
      request.dictionarySettings ?? DEFAULT_CONTEXT_DICTIONARY_SETTINGS,
    );
  }
  return request.outputFields;
}

export function buildContextLookupTelemetryPayload(input: {
  mode: ContextLookupMode;
  selectedText: string;
  targetLanguage: string;
  sourceLanguage: string;
  detectedLanguage: DetectedLanguageInfo;
  validationDecision: ValidationDecision;
  repairCount: number;
  degradationPath: ContextLookupDegradationPath;
  rawResponse: string;
}): ContextLookupTelemetryPayload {
  const plugins = resolveLookupPlugins({
    sourceLanguage: input.sourceLanguage,
    targetLanguage: input.targetLanguage,
    mode: input.mode,
  });

  return {
    mode: input.mode,
    decision: input.validationDecision,
    repairCount: input.repairCount,
    degradationPath: input.degradationPath,
    sourceLanguage: input.sourceLanguage,
    targetLanguage: input.targetLanguage,
    detectedLanguage: input.detectedLanguage.language,
    detectionConfidence: input.detectedLanguage.confidence,
    mixed: input.detectedLanguage.mixed,
    sourcePlugin: plugins.source.language,
    targetPlugin: plugins.target.language,
    structuredOutput: input.rawResponse.includes('<lookup_json>'),
    selectedTextLength: input.selectedText.length,
  };
}

/**
 * Shared lookup service:
 * 1. Detects source language from selectedText
 * 2. Builds prompts via buildLookupPrompt
 * 3. Calls the LLM (skipped if preNormalizedFields is provided)
 * 4. Normalizes the response
 * 5. Validates the result
 * 6. Returns a ContextLookupResult
 */
export async function runContextLookup(
  request: ContextLookupRequest,
): Promise<ContextLookupResult> {
  const detectedLanguage = detectLookupLanguage(request.selectedText);
  const sourceLanguage = request.sourceLanguage ?? detectedLanguage.language;

  // Use pre-resolved dictionary entries if provided, otherwise look them up
  let dictionaryEntries: string[] = [];
  if (request.preDictionaryEntries) {
    dictionaryEntries = request.preDictionaryEntries;
  } else {
    try {
      const entries = await lookupDefinitions(
        request.selectedText,
        sourceLanguage,
        request.targetLanguage,
        request.userDictionaryMeta ?? [],
        { maxMatchTier: 1 },
      );
      dictionaryEntries = entries.map((e) => `${e.headword}: ${e.definition}`);
    } catch {
      dictionaryEntries = [];
    }
  }

  // Create popup context with dictionary entries
  const popupContextWithDictionary: PopupContextBundle = {
    ...request.popupContext,
    dictionaryEntries,
  };
  const effectiveOutputFields = resolveEffectiveOutputFields(request);

  const primaryField = resolvePrimaryField(effectiveOutputFields);
  const plugins = resolveLookupPlugins({
    sourceLanguage,
    targetLanguage: request.targetLanguage,
    mode: request.mode,
  });

  const { systemPrompt, userPrompt } = buildLookupPrompt({
    mode: request.mode,
    selectedText: request.selectedText,
    popupContext: popupContextWithDictionary,
    targetLanguage: request.targetLanguage,
    sourceLanguage,
    outputFields: effectiveOutputFields,
    dictionarySettings: request.dictionarySettings,
    systemPromptTemplate: request.systemPromptTemplate,
  });

  const runAttempt = async (
    system: string,
    user: string,
    overrideFields?: NormalizedLookupResult,
    overrideRaw?: string,
  ) => {
    const raw =
      overrideRaw ??
      (await callLLM(
        system,
        user,
        request.model as LanguageModel,
        request.abortSignal,
        request.inferenceParams,
      ));
    const normalized = overrideFields ?? normalizeLookupResponse(raw, request.mode);
    const fields = formatEnabledLookupResult(normalized, {
      mode: request.mode,
      selectedText: request.selectedText,
      sourceLanguage,
      targetLanguage: request.targetLanguage,
      outputFields: effectiveOutputFields,
      dictionarySettings: request.dictionarySettings,
      pageContext: request.popupContext.localPastContext,
    });
    const validation = validateLookupResult(
      fields,
      primaryField,
      request.selectedText,
      sourceLanguage,
      request.targetLanguage,
    );

    return { raw, fields, validation };
  };

  let repairCount = 0;
  let degradationPath: ContextLookupDegradationPath = 'none';
  let attempt =
    request.preNormalizedFields !== undefined && request.rawResponse !== undefined
      ? await runAttempt(systemPrompt, userPrompt, request.preNormalizedFields, request.rawResponse)
      : await runAttempt(systemPrompt, userPrompt);

  if (attempt.validation.decision === 'degrade' && CONTEXT_LOOKUP_ROLLOUT.repairOnDegrade) {
    repairCount = 1;

    const orderedFieldIds = effectiveOutputFields
      .filter((f) => f.enabled)
      .sort((a, b) => a.order - b.order)
      .map((f) => f.id)
      .join(', ');

    const repairPrompt = buildRepairPrompt({
      originalSystemPrompt: systemPrompt,
      originalUserPrompt: userPrompt,
      issue: attempt.validation.reason ?? `${primaryField} field is empty or missing`,
      orderedFieldIds,
    });

    attempt = await runAttempt(repairPrompt.systemPrompt, repairPrompt.userPrompt);
    degradationPath =
      attempt.validation.decision === 'degrade' ? 'repair-failed' : 'repair-recovered';
  }

  contextLookupTelemetry.logOutcome(
    buildContextLookupTelemetryPayload({
      mode: request.mode,
      selectedText: request.selectedText,
      targetLanguage: request.targetLanguage,
      sourceLanguage,
      detectedLanguage,
      validationDecision: attempt.validation.decision,
      repairCount,
      degradationPath,
      rawResponse: attempt.raw,
    }),
  );

  const parsedExamples = parseRenderableExampleField(
    attempt.fields,
    request.selectedText,
    request.targetLanguage,
    request.mode === 'dictionary' ? { allowIncomplete: true } : undefined,
  );
  const sourceAnnotations = plugins.source.enrichSourceAnnotations?.(
    attempt.fields,
    request.selectedText,
  );
  const targetAnnotations = plugins.target.enrichTargetAnnotations?.(
    attempt.fields,
    request.selectedText,
  );
  const sourceExampleAnnotations = plugins.source.enrichExampleAnnotations?.(
    parsedExamples,
    'source',
  );
  const targetExampleAnnotations = plugins.target.enrichExampleAnnotations?.(
    parsedExamples,
    'target',
  );
  const annotations: LookupAnnotationSlots = {
    source:
      sourceAnnotations || sourceExampleAnnotations
        ? {
            ...sourceAnnotations,
            examples: sourceExampleAnnotations ?? sourceAnnotations?.examples,
          }
        : undefined,
    target:
      targetAnnotations || targetExampleAnnotations
        ? {
            ...targetAnnotations,
            examples: targetExampleAnnotations ?? targetAnnotations?.examples,
          }
        : undefined,
  };

  return {
    fields: attempt.fields,
    examples: parsedExamples,
    annotations,
    validationDecision: attempt.validation.decision,
    detectedLanguage,
  };
}
