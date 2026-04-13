import { detectLanguage, inferLangFromScript, isCJKStr } from '@/utils/lang';

export type DetectedLanguageInfo = {
  language: string;
  confidence: number;
  mixed: boolean;
};

/**
 * Builds a locale fallback chain for plugin resolution.
 * e.g. 'zh-Hans-CN' → ['zh-Hans-CN', 'zh-Hans', 'zh', 'fallback']
 */
export function resolvePluginLanguage(locale: string): string[] {
  const parts = locale.split('-');
  const chain: string[] = [];

  for (let i = parts.length; i > 0; i--) {
    chain.push(parts.slice(0, i).join('-'));
  }

  chain.push('fallback');
  return chain;
}

/**
 * Detects the primary language of a text snippet, plus whether it
 * contains a significant mix of scripts (e.g. Latin + CJK).
 *
 * When `bookLanguage` is provided (from epub metadata), it acts as a
 * strong prior for short or ambiguous text where statistical detection
 * is unreliable.
 */
export function detectLookupLanguage(text: string, bookLanguage?: string): DetectedLanguageInfo {
  const hasCJK = isCJKStr(text);
  const hasLatin = /[a-zA-Z]{2,}/.test(text);
  const mixed = hasCJK && hasLatin;

  const rawLang = detectLanguage(text);
  // For very short strings franc may return 'en' even for CJK — defer to script detection.
  const language = inferLangFromScript(text, rawLang);

  // franc doesn't expose per-result confidence; use a heuristic:
  // short or mixed text is lower confidence.
  const lengthFactor = Math.min(text.length / 20, 1);
  const confidence = mixed ? 0.5 * lengthFactor : 0.9 * lengthFactor;

  // If confidence is low and the book language is known, prefer the book language
  // — but only if it's plausible given the script (don't override CJK detection
  // with a Latin book language).
  if (bookLanguage && confidence < 0.7) {
    const bookLangBase = bookLanguage.split('-')[0]!.toLowerCase();
    const detectedBase = language.split('-')[0]!.toLowerCase();

    // Use book language if scripts are compatible
    const bookIsCJK = ['zh', 'ja', 'ko'].includes(bookLangBase);
    if ((hasCJK && bookIsCJK) || (!hasCJK && !bookIsCJK) || detectedBase === 'und') {
      return { language: bookLangBase, confidence: 0.85, mixed };
    }
  }

  return { language, confidence, mixed };
}
