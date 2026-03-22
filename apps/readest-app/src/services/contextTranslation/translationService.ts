import type { LanguageModel } from 'ai';
import type { ContextDictionarySettings, TranslationRequest, TranslationResult, TranslationStreamResult } from './types';
import type { ContextLookupMode } from './modes';
import { formatTranslationResult } from './exampleFormatter';
import { buildTranslationPrompt, buildLookupPrompt } from './promptBuilder';
import { parseStreamingTranslationResponse, parseTranslationResponse } from './responseParser';
import { normalizeLookupResponse } from './normalizer';
import { callLLM, streamLLM } from './llmClient';
import { getContextDictionaryOutputFields, DEFAULT_CONTEXT_DICTIONARY_SETTINGS } from './defaults';

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
  return formatTranslationResult(parseTranslationResponse(response, request.outputFields), request);
}

export async function* streamTranslationWithContext(
  request: TranslationRequest,
  model: LanguageModel,
  abortSignal?: AbortSignal,
): AsyncGenerator<TranslationStreamResult> {
  const { systemPrompt, userPrompt } = buildTranslationPrompt(request);
  let rawText = '';

  for await (const chunk of streamLLM(systemPrompt, userPrompt, model, abortSignal)) {
    rawText += chunk;
    const parsed = parseStreamingTranslationResponse(rawText, request.outputFields);
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
  request: TranslationRequest & { mode: ContextLookupMode; dictionarySettings?: ContextDictionarySettings },
  model: LanguageModel,
  abortSignal?: AbortSignal,
): AsyncGenerator<LookupStreamResult> {
  const { systemPrompt, userPrompt } = buildLookupPrompt({
    ...request,
    popupContext: request.popupContext,
  });
  const streamFields =
    request.mode === 'dictionary'
      ? getContextDictionaryOutputFields(request.dictionarySettings ?? DEFAULT_CONTEXT_DICTIONARY_SETTINGS)
      : request.outputFields;
  let rawText = '';

  for await (const chunk of streamLLM(systemPrompt, userPrompt, model, abortSignal)) {
    rawText += chunk;
    const parsed = parseStreamingTranslationResponse(rawText, streamFields);
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
