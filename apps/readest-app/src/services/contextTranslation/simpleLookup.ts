import { lookupDefinitions } from './dictionaryService';
import type { ContextLookupRequest, ContextLookupResult } from './contextLookupService';

export type TranslationSource = 'ai' | 'dictionary';

function buildSimpleResult(
  translationContent: string,
  sourceLanguage: string,
): ContextLookupResult {
  return {
    fields: { translation: translationContent },
    examples: [],
    annotations: {},
    validationDecision: 'accept',
    detectedLanguage: {
      language: sourceLanguage,
      confidence: 1,
      mixed: false,
    },
  };
}

export async function runSimpleLookup(
  request: ContextLookupRequest,
  _source: Exclude<TranslationSource, 'ai'>,
): Promise<ContextLookupResult> {
  const srcLang = request.sourceLanguage ?? 'en';
  const entries = await lookupDefinitions(request.selectedText, srcLang, request.targetLanguage);
  const content = entries.map((e) => `${e.headword}: ${e.definition}`).join('\n');
  return buildSimpleResult(content, srcLang);
}
