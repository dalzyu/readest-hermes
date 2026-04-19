import { getTranslators, isTranslatorAvailable } from './providers';
import type { TranslatorName } from './providers';

export interface TranslateWithUpstreamInput {
  text: string;
  sourceLang: string;
  targetLang: string;
  preferred?: TranslatorName;
  token?: string | null;
  useCache?: boolean;
}

export interface TranslateWithUpstreamResult {
  text: string;
  providerUsed: TranslatorName | null;
}

/**
 * Performs hook-free translator selection for service-layer callers.
 *
 * Fallback order:
 * 1) Preferred provider (if configured and available)
 * 2) First available provider in declaration order from providers/index.ts
 *
 * Current declaration order is DeepL → Azure → Google → Yandex. In no-auth
 * sessions DeepL is skipped, so Azure is the default fallback.
 */
export async function translateWithUpstream({
  text,
  sourceLang,
  targetLang,
  preferred,
  token,
  useCache = true,
}: TranslateWithUpstreamInput): Promise<TranslateWithUpstreamResult> {
  const input = text.trim();
  if (!input) {
    return { text: '', providerUsed: null };
  }

  const hasToken = Boolean(token);
  const translators = getTranslators();

  const orderedNames: TranslatorName[] = [];
  if (preferred) {
    orderedNames.push(preferred);
  }

  for (const translator of translators) {
    const translatorName = translator.name as TranslatorName;
    if (!orderedNames.includes(translatorName)) {
      orderedNames.push(translatorName);
    }
  }

  for (const providerName of orderedNames) {
    const translator = translators.find((entry) => entry.name === providerName);
    if (!translator) continue;
    if (!isTranslatorAvailable(translator, hasToken)) continue;

    try {
      const [translated] = await translator.translate(
        [input],
        sourceLang,
        targetLang,
        token,
        useCache,
      );

      if (translated?.trim()) {
        return {
          text: translated,
          providerUsed: providerName,
        };
      }
    } catch {
      // Continue fallback chain when an upstream provider fails at runtime.
    }
  }

  return {
    text: '',
    providerUsed: null,
  };
}
