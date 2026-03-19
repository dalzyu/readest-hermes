import type { LanguageModel } from 'ai';
import type { TranslationRequest, TranslationResult, TranslationStreamResult } from './types';
import { formatTranslationResult } from './exampleFormatter';
import { buildTranslationPrompt } from './promptBuilder';
import { parseStreamingTranslationResponse, parseTranslationResponse } from './responseParser';
import { callLLM, streamLLM } from './llmClient';

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
    fields: formatTranslationResult(parseTranslationResponse(rawText, request.outputFields), request),
    activeFieldId: null,
    rawText,
    done: true,
  };
}
