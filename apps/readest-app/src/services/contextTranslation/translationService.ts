import type { LanguageModel } from 'ai';
import type {
  ContextDictionarySettings,
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
import { getContextDictionaryOutputFields, DEFAULT_CONTEXT_DICTIONARY_SETTINGS } from './defaults';

function hasUsablePrimaryField(
  parsed: TranslationResult,
  request: TranslationRequest,
): boolean {
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
Do not include reasoning, markdown, or any extra text.`,
    userPrompt: `Retry the same request exactly and return only valid XML tags in the required order.\n\nOriginal request:\n${originalUserPrompt}`,
  };
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
): Promise<TranslationResult> {
  const { systemPrompt, userPrompt } = buildTranslationPrompt(request);
  const response = await callLLM(systemPrompt, userPrompt, model!, abortSignal);
  let parsed = parseTranslationResponse(response, request.outputFields);

  // Weak models frequently drift outside required tags; retry once with a strict repair prompt.
  if (!hasUsablePrimaryField(parsed, request) || completionRatio(parsed, request) < 0.5) {
    const repair = buildTranslationRepairPrompt(
      systemPrompt,
      userPrompt,
      request.outputFields
        .filter((field) => field.enabled)
        .sort((a, b) => a.order - b.order)
        .map((field) => field.id),
    );
    const repairedResponse = await callLLM(repair.systemPrompt, repair.userPrompt, model!, abortSignal);
    const repairedParsed = parseTranslationResponse(repairedResponse, request.outputFields);
    if (hasUsablePrimaryField(repairedParsed, request)) {
      parsed = repairedParsed;
    }
  }

  return formatTranslationResult(parsed, request);
}

export async function* streamTranslationWithContext(
  request: TranslationRequest,
  model: LanguageModel,
  abortSignal?: AbortSignal,
): AsyncGenerator<TranslationStreamResult> {
  const { systemPrompt, userPrompt } = buildTranslationPrompt(request);
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
      parseTranslationResponse(rawText, request.outputFields),
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
  allDone.then(() => { settled = true; }).catch(() => { settled = true; });

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
