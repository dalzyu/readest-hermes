import { toRomaji } from 'wanakana';
import type { LookupAnnotations, LookupExample } from '../types';
import type { LookupPlugin } from './types';
import { HAN_REGEX } from '../utils';
import { getReadingRomaji, isTokenizerReady, initJapaneseTokenizer } from './jpTokenizer';

// Pre-warm the tokenizer so it is ready when the user first selects text.
// This is a no-op if the tokenizer is already loading / loaded.
if (typeof window !== 'undefined') {
  initJapaneseTokenizer().catch(() => {
    /* dict load failure is non-fatal — we fall back to kana-only */
  });
}

/**
 * Returns true when the text contains kanji (CJK unified ideographs).
 * wanakana.toRomaji leaves kanji untouched, producing broken mixed output
 * like "食beru" for "食べる". We need kuromoji for proper romanization.
 */
function containsKanji(text: string): boolean {
  return HAN_REGEX.test(text);
}

/**
 * Deterministic romaji for Japanese text.
 *
 * Strategy:
 * 1. If text is kana-only → wanakana (instant, no dict needed)
 * 2. If text contains kanji AND kuromoji is ready → kuromoji (accurate)
 * 3. If text contains kanji AND kuromoji NOT ready → return '' (graceful skip)
 *
 * The LLM is NEVER used as the source of truth for phonetics.
 */
function safeRomaji(text: string): string {
  if (containsKanji(text)) {
    // kuromoji provides deterministic, context-aware readings for kanji
    if (isTokenizerReady()) {
      return getReadingRomaji(text);
    }
    return ''; // tokenizer not ready yet — skip gracefully
  }
  const romaji = toRomaji(text).trim();
  // Guard: if toRomaji returned the input unchanged, there was nothing to convert
  if (romaji === text) return '';
  return romaji;
}

function buildExampleAnnotations(
  examples: LookupExample[],
  slot: 'source' | 'target',
): LookupAnnotations['examples'] | undefined {
  const key = slot === 'source' ? 'sourceText' : 'targetText';
  const annotations = Object.fromEntries(
    examples
      .map((example) => {
        const romaji = safeRomaji(example[key]);
        return romaji ? [example.exampleId, { phonetic: romaji }] : null;
      })
      .filter((entry): entry is [string, { phonetic: string }] => entry !== null),
  );

  return Object.keys(annotations).length > 0 ? annotations : undefined;
}

export const jaPlugin: LookupPlugin = {
  language: 'ja',
  enrichSourceAnnotations(
    _fields: Record<string, string>,
    selectedText: string,
  ): LookupAnnotations | undefined {
    const romaji = safeRomaji(selectedText);
    if (!romaji) return undefined;
    return { phonetic: romaji };
  },
  enrichExampleAnnotations(examples, slot) {
    return buildExampleAnnotations(examples, slot);
  },
};
