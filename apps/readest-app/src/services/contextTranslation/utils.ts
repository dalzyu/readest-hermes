export const HAN_REGEX = /[\u3400-\u9fff]/u;
export const HIRAGANA_REGEX = /[\u3040-\u309f]/u;
export const KATAKANA_REGEX = /[\u30a0-\u30ff]/u;

export type CJKLanguage = 'chinese' | 'japanese' | 'korean' | 'other';

/**
 * Returns the CJK language for a given text by checking the page context for
 * script markers. This correctly disambiguates pure-kanji Japanese from Chinese
 * by looking at whether the surrounding page contains hiragana/katakana (Japanese)
 * or hangul (Korean). Falls back to the text's own Han-character content.
 */
export function getCJKLanguage(text: string, pageContext: string): CJKLanguage {
  // If the page context has Japanese script markers, the page is Japanese
  if (HIRAGANA_REGEX.test(pageContext) || KATAKANA_REGEX.test(pageContext)) {
    return 'japanese';
  }
  // If the page context has Korean script markers, the page is Korean
  if (/[\uac00-\ud7af\u1100-\u11ff]/u.test(pageContext)) {
    return 'korean';
  }
  // Otherwise determine from the text itself: Han chars without Japanese markers → Chinese
  if (HAN_REGEX.test(text) && !isJapaneseText(text)) {
    return 'chinese';
  }
  if (HAN_REGEX.test(text) && isJapaneseText(text)) {
    return 'japanese';
  }
  return 'other';
}

export function isJapaneseText(value: string): boolean {
  return HIRAGANA_REGEX.test(value) || KATAKANA_REGEX.test(value);
}

export function isChineseText(value: string): boolean {
  // Has CJK chars but is not Japanese (Japanese has its own scripts)
  return HAN_REGEX.test(value) && !isJapaneseText(value);
}
