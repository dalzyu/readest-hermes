import type { LanguageModel } from 'ai';
import type {
  ContextDictionarySettings,
  ContextTranslationHarnessSettings,
  TranslationRequest,
  TranslationResult,
  TranslationStreamResult,
} from './types';
import type { ContextLookupMode } from './modes';
import { formatTranslationResult } from './exampleFormatter';
import { buildTranslationPrompt, buildLookupPrompt, buildPerFieldPrompt } from './promptBuilder';
import { parseTranslationResponse, StreamingParser } from './responseParser';
import { normalizeLookupResponse } from './normalizer';
import { callLLM, streamLLM } from './llmClient';
import {
  getContextDictionaryOutputFields,
  DEFAULT_CONTEXT_DICTIONARY_SETTINGS,
  resolveContextTranslationHarnessSettings,
} from './defaults';
import { sanitizeFieldContent, sanitizeTranslationResult } from './translationSanitizer';

function hasUsablePrimaryField(parsed: TranslationResult, request: TranslationRequest): boolean {
  const primary = request.outputFields.find((field) => field.enabled)?.id ?? 'translation';
  return Boolean(parsed[primary]?.trim());
}

function completionRatio(parsed: TranslationResult, request: TranslationRequest): number {
  const enabledCount = request.outputFields.filter((field) => field.enabled).length;
  if (enabledCount === 0) return 1;
  const completed = request.outputFields.filter(
    (field) => field.enabled && Boolean(parsed[field.id]?.trim()),
  ).length;
  return completed / enabledCount;
}

function escapeRegexLiteral(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

function responseLooksContaminated(
  response: string,
  harness: ContextTranslationHarnessSettings,
): boolean {
  if (!harness.detectContamination || !response.trim()) return false;
  const markers = [...harness.contaminationMarkers, ...harness.reasoningMarkers]
    .map((marker) => escapeRegexLiteral(marker.trim()))
    .filter(Boolean);
  if (markers.length === 0) return false;
  return new RegExp(markers.join('|'), 'i').test(response);
}

function buildTranslationRepairPrompt(
  originalSystemPrompt: string,
  originalUserPrompt: string,
  fieldIds: string[],
): { systemPrompt: string; userPrompt: string } {
  const template = fieldIds.map((id) => `<${id}>...</${id}>`).join('\n');
  return {
    systemPrompt: `${originalSystemPrompt}

The previous answer did not follow the required XML shape.
Rewrite the answer now with ONLY these tags and in this exact order:
${template}
Do not include reasoning, markdown, or any extra text.
Do not write phrases like "Thinking Process", "The user wants me", "Analyze the Request", steps, plans, or self-referential analysis inside any tag.`,
    userPrompt: `Retry the same request exactly and return only valid XML tags in the required order.\n\nOriginal request:\n${originalUserPrompt}`,
  };
}

function buildPerFieldRepairPrompt(
  fieldId: string,
  targetLanguage: string,
  originalSystemPrompt: string,
  originalUserPrompt: string,
): { systemPrompt: string; userPrompt: string } {
  return {
    systemPrompt: `You are a literary translation assistant.

Return ONLY the final ${fieldId} content in ${targetLanguage}.
Do not reveal your reasoning. Do not write "Thinking Process", "The user wants me", "Analyze the Request", confidence scores, plans, steps, XML tags, labels, markdown, or extra commentary.
Original field request:
${originalSystemPrompt}`,
    userPrompt: `Retry the same ${fieldId} request and output only the final content.

Original request:
${originalUserPrompt}`,
  };
}

function shouldRunRepair(
  parsed: TranslationResult,
  request: TranslationRequest,
  responseContaminated: boolean,
  harness: ContextTranslationHarnessSettings,
): boolean {
  if (!harness.repairEnabled) return false;
  if (harness.repairOnContamination && responseContaminated) return true;
  if (harness.repairOnMissingPrimary && !hasUsablePrimaryField(parsed, request)) return true;
  if (
    harness.repairOnLowCompletion &&
    completionRatio(parsed, request) < harness.completionThreshold
  ) {
    return true;
  }
  return false;
}

export type FinalizeTranslationSeed = {
  initialRawText?: string;
  initialFields?: TranslationResult;
};

export type FinalizedTranslation = {
  fields: TranslationResult;
  rawText: string;
};

export async function finalizeTranslationWithContext(
  request: TranslationRequest,
  model?: LanguageModel,
  abortSignal?: AbortSignal,
  seed?: FinalizeTranslationSeed,
): Promise<FinalizedTranslation> {
  const harness = resolveContextTranslationHarnessSettings(request.harness);
  const { systemPrompt, userPrompt } = buildTranslationPrompt(request);
  let latestRawText =
    seed?.initialRawText ?? (await callLLM(systemPrompt, userPrompt, model!, abortSignal)) ?? '';
  let parsed = sanitizeTranslationResult(
    seed?.initialFields ?? parseTranslationResponse(latestRawText, request.outputFields),
    harness,
  );
  let responseContaminated = responseLooksContaminated(latestRawText, harness);

  let repairAttempts = 0;
  while (
    repairAttempts < harness.maxRepairAttempts &&
    shouldRunRepair(parsed, request, responseContaminated, harness)
  ) {
    repairAttempts += 1;
    const repair = buildTranslationRepairPrompt(
      systemPrompt,
      userPrompt,
      request.outputFields
        .filter((field) => field.enabled)
        .sort((a, b) => a.order - b.order)
        .map((field) => field.id),
    );
    latestRawText =
      (await callLLM(repair.systemPrompt, repair.userPrompt, model!, abortSignal)) ?? '';
    parsed = sanitizeTranslationResult(
      parseTranslationResponse(latestRawText, request.outputFields),
      harness,
    );
    responseContaminated = responseLooksContaminated(latestRawText, harness);
  }

  if (
    harness.flow === 'production' &&
    harness.perFieldRescueEnabled &&
    (!hasUsablePrimaryField(parsed, request) || responseContaminated)
  ) {
    const stitched: TranslationResult = {};
    const enabledFields = request.outputFields
      .filter((field) => field.enabled)
      .sort((a, b) => a.order - b.order);

    for (const field of enabledFields) {
      const perField = buildPerFieldPrompt(field, request);
      let fieldValue =
        (await callLLM(perField.systemPrompt, perField.userPrompt, model!, abortSignal)) ?? '';
      let sanitizedFieldValue = sanitizeFieldContent(field.id, fieldValue, harness);

      let perFieldRepairAttempts = 0;
      while (
        perFieldRepairAttempts < harness.maxPerFieldRepairAttempts &&
        (responseLooksContaminated(fieldValue, harness) || !sanitizedFieldValue.trim())
      ) {
        perFieldRepairAttempts += 1;
        const repair = buildPerFieldRepairPrompt(
          field.id,
          request.targetLanguage,
          perField.systemPrompt,
          perField.userPrompt,
        );
        fieldValue =
          (await callLLM(repair.systemPrompt, repair.userPrompt, model!, abortSignal)) ?? '';
        sanitizedFieldValue = sanitizeFieldContent(field.id, fieldValue, harness);
      }

      stitched[field.id] = sanitizedFieldValue;
    }

    parsed = stitched;
    latestRawText = enabledFields
      .map((field) => `<${field.id}>${parsed[field.id] ?? ''}</${field.id}>`)
      .join('\n');
  }

  return { fields: parsed, rawText: latestRawText };
}

/**
 * Orchestrates context-aware translation:
 * 1. Builds system + user prompts from the request
 * 2. Calls the LLM
 * 3. Parses the structured response
 */
export async function translateWithContext(
  request: TranslationRequest,
  model?: LanguageModel,
  abortSignal?: AbortSignal,
  seed?: FinalizeTranslationSeed,
): Promise<TranslationResult> {
  const finalized = await finalizeTranslationWithContext(request, model, abortSignal, seed);
  return formatTranslationResult(finalized.fields, request);
}

export async function* streamTranslationWithContext(
  request: TranslationRequest,
  model: LanguageModel,
  abortSignal?: AbortSignal,
): AsyncGenerator<TranslationStreamResult> {
  const { systemPrompt, userPrompt } = buildTranslationPrompt(request);
  const harness = resolveContextTranslationHarnessSettings(request.harness);
  let rawText = '';
  const parser = new StreamingParser();

  for await (const chunk of streamLLM(systemPrompt, userPrompt, model, abortSignal)) {
    rawText += chunk;
    const parsed = parser.parse(rawText, request.outputFields);
    yield {
      fields: formatTranslationResult(parsed.fields, request),
      activeFieldId: parsed.activeFieldId,
      rawText,
      done: false,
    };
  }

  yield {
    fields: formatTranslationResult(
      sanitizeTranslationResult(parseTranslationResponse(rawText, request.outputFields), harness),
      request,
    ),
    activeFieldId: null,
    rawText,
    done: true,
  };
}

export type LookupStreamResult = {
  fields: TranslationResult;
  activeFieldId: string | null;
  rawText: string;
  done: boolean;
};

/**
 * Streams a context-aware dictionary lookup, yielding partial results as XML tags arrive,
 * then uses <lookup_json> for the authoritative final parse.
 */
export async function* streamLookupWithContext(
  request: TranslationRequest & {
    mode: ContextLookupMode;
    dictionarySettings?: ContextDictionarySettings;
  },
  model: LanguageModel,
  abortSignal?: AbortSignal,
): AsyncGenerator<LookupStreamResult> {
  const { systemPrompt, userPrompt } = buildLookupPrompt({
    ...request,
    popupContext: request.popupContext,
  });
  const streamFields =
    request.mode === 'dictionary'
      ? getContextDictionaryOutputFields(
          request.dictionarySettings ?? DEFAULT_CONTEXT_DICTIONARY_SETTINGS,
        )
      : request.outputFields;
  let rawText = '';
  const parser = new StreamingParser();

  for await (const chunk of streamLLM(systemPrompt, userPrompt, model, abortSignal)) {
    rawText += chunk;
    const parsed = parser.parse(rawText, streamFields);
    yield {
      fields: parsed.fields,
      activeFieldId: parsed.activeFieldId,
      rawText,
      done: false,
    };
  }

  // Final: use normalizeLookupResponse with the complete raw text for authoritative parse
  yield {
    fields: normalizeLookupResponse(rawText, request.mode),
    activeFieldId: null,
    rawText,
    done: true,
  };
}

// ---------------------------------------------------------------------------
// Per-field parallel streaming (fieldStrategy === 'multi')
// ---------------------------------------------------------------------------

/**
 * Streams N independent LLM calls in parallel — one per enabled output field.
 * Each field result is yielded as it arrives, identified by `activeFieldId`.
 * The final yield has `done: true` and the merged results.
 */
export async function* streamPerFieldTranslation(
  request: TranslationRequest,
  model: LanguageModel,
  abortSignal?: AbortSignal,
): AsyncGenerator<TranslationStreamResult> {
  const enabledFields = request.outputFields
    .filter((f) => f.enabled)
    .sort((a, b) => a.order - b.order);

  // Shared mutable state — each field updates its slot
  const merged: TranslationResult = {};
  let latestActiveFieldId: string | null = null;

  // Launch one stream per field
  const fieldStreams = enabledFields.map(async (field) => {
    const { systemPrompt, userPrompt } = buildPerFieldPrompt(field, request);
    let fieldText = '';

    for await (const chunk of streamLLM(systemPrompt, userPrompt, model, abortSignal)) {
      fieldText += chunk;
      merged[field.id] = fieldText.trim();
      latestActiveFieldId = field.id;
    }

    // Mark field done with final trim
    merged[field.id] = fieldText.trim();
  });

  // Poll merged results while any stream is still running
  const allDone = Promise.all(fieldStreams);
  let settled = false;
  allDone
    .then(() => {
      settled = true;
    })
    .catch(() => {
      settled = true;
    });

  while (!settled) {
    // Yield current snapshot
    yield {
      fields: formatTranslationResult({ ...merged }, request),
      activeFieldId: latestActiveFieldId,
      rawText: '', // individual raw texts not meaningful in multi mode
      done: false,
    };
    // Brief pause to batch updates instead of busy-looping
    await new Promise((resolve) => setTimeout(resolve, 50));
  }

  // Yield final merged result
  yield {
    fields: formatTranslationResult({ ...merged }, request),
    activeFieldId: null,
    rawText: '',
    done: true,
  };
}
