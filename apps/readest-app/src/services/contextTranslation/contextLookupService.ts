import type { LanguageModel } from 'ai';
import type { ContextLookupMode } from './modes';
import type { TranslationOutputField, PopupContextBundle } from './types';
import type { NormalizedLookupResult } from './normalizer';
import type { DetectedLanguageInfo } from './languagePolicy';
import type { ValidationDecision } from './validator';
import { detectLookupLanguage } from './languagePolicy';
import { buildLookupPrompt } from './promptBuilder';
import { callLLM } from './llmClient';
import { normalizeLookupResponse } from './normalizer';
import { validateLookupResult } from './validator';

export interface ContextLookupRequest {
  mode: ContextLookupMode;
  selectedText: string;
  popupContext: PopupContextBundle;
  targetLanguage: string;
  sourceLanguage?: string;
  outputFields: TranslationOutputField[];
  model?: LanguageModel;
  abortSignal?: AbortSignal;
}

export interface ContextLookupResult {
  fields: NormalizedLookupResult;
  validationDecision: ValidationDecision;
  detectedLanguage: DetectedLanguageInfo;
}

/**
 * Shared lookup service:
 * 1. Detects source language from selectedText
 * 2. Builds prompts via buildLookupPrompt
 * 3. Calls the LLM
 * 4. Normalizes the response
 * 5. Validates the result
 * 6. Returns a ContextLookupResult
 */
export async function runContextLookup(
  request: ContextLookupRequest,
): Promise<ContextLookupResult> {
  const detectedLanguage = detectLookupLanguage(request.selectedText);

  const sourceLanguage = request.sourceLanguage ?? detectedLanguage.language;

  const { systemPrompt, userPrompt } = buildLookupPrompt({
    mode: request.mode,
    selectedText: request.selectedText,
    popupContext: request.popupContext,
    targetLanguage: request.targetLanguage,
    sourceLanguage,
    outputFields: request.outputFields,
  });

  const raw = await callLLM(
    systemPrompt,
    userPrompt,
    request.model as LanguageModel,
    request.abortSignal,
  );

  const fields = normalizeLookupResponse(raw, request.mode);
  const validation = validateLookupResult(fields, 'translation', request.selectedText);

  return {
    fields,
    validationDecision: validation.decision,
    detectedLanguage,
  };
}
