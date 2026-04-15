import { lookupDefinitions } from './dictionaryService';
import { getTranslators } from '@/services/translators';
import type { ContextLookupRequest, ContextLookupResult } from './contextLookupService';

export type TranslationSource = 'ai' | 'dictionary' | 'azure' | 'deepl' | 'google' | 'yandex';

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
  source: Exclude<TranslationSource, 'ai'>,
): Promise<ContextLookupResult> {
  const srcLang = request.sourceLanguage ?? 'en';

  if (source === 'dictionary') {
    const entries = await lookupDefinitions(
      request.selectedText,
      srcLang,
      request.targetLanguage,
    );
    const content = entries.map((e) => `${e.headword}: ${e.definition}`).join('\n');
    return buildSimpleResult(content, srcLang);
  }

  // Service translators — getTranslators() is SYNCHRONOUS
  const allTranslators = getTranslators();
  const translator = allTranslators.find((t) => t.name.toLowerCase() === source.toLowerCase());
  if (!translator) {
    throw new Error(`${source} translator not found. Configure it in Settings → Language.`);
  }

  // translate(texts, sourceLang, targetLang, token?, useCache?) => Promise<string[]>
  const results = await translator.translate(
    [request.selectedText],
    srcLang,
    request.targetLanguage,
  );

  return buildSimpleResult(results[0] ?? '', srcLang);
}
