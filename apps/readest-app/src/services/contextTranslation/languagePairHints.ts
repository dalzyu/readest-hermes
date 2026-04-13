/**
 * Language-pair-specific prompt hints that improve translation quality
 * for particular source-target language combinations.
 *
 * These hints supplement the generic translation prompt with guidance
 * for common challenges in specific language pairs.
 */

export interface LanguagePairHint {
  /** Brief prompt addition for the system message */
  hint: string;
}

type PairKey = `${string}->${string}`;

/**
 * Registry of language-pair-specific hints.
 * Key format: "source->target" using ISO 639-1 codes.
 * Wildcard keys like "zh->*" or "*->zh" apply to all pairs involving that language.
 */
const PAIR_HINTS: Record<PairKey, LanguagePairHint> = {
  // CJK -> Latin: word boundaries and compounds
  'zh->en': {
    hint: 'Chinese compounds should be translated as unified concepts. Pay attention to four-character idioms (成语) - give the idiomatic meaning, not a literal character-by-character breakdown.',
  },
  'zh->*': {
    hint: 'When translating from Chinese, preserve the register (formal/informal) and pay special attention to measure words and aspect markers that may not have direct equivalents.',
  },
  'ja->en': {
    hint: 'Japanese text may omit subjects - infer from context. Honorific levels (敬語) should be reflected in the translation register. Compound verbs should be translated as single concepts.',
  },
  'ja->*': {
    hint: 'Japanese text often omits the subject and relies on context. Compound verbs, grammatical particles, and honorific levels carry meaning that should be reflected in the translation.',
  },
  'ko->en': {
    hint: 'Korean sentence structure is SOV. Honorific levels and speech styles (formal/informal) should be reflected in the translation.',
  },

  // Latin -> CJK: register and formality
  'en->zh': {
    hint: 'Choose the appropriate register (书面语 vs 口语). For literary text, prefer more literary Chinese phrasing. Avoid overly literal translations that sound unnatural in Chinese.',
  },
  'en->ja': {
    hint: 'Select the appropriate formality level (です/ます vs plain form) based on the context. Literary translations should use appropriate literary Japanese.',
  },
  'en->*': {
    hint: 'English source text often hides idioms, phrasal verbs, and compressed metaphor inside short phrases. Translate the underlying meaning, not the English surface order, and keep the translation field short and direct.',
  },

  // Same-family pairs: false friends
  'es->pt': {
    hint: 'Beware of false friends between Spanish and Portuguese (e.g., "embarazada" means pregnant, not embarrassed). Verify similar-looking words carefully.',
  },
  'pt->es': {
    hint: 'Beware of false friends between Portuguese and Spanish. Similar-looking words may have different meanings.',
  },
  'de->nl': {
    hint: 'German and Dutch share many cognates but with different meanings. Watch for false friends and subtle register differences.',
  },
  'nl->de': {
    hint: 'Dutch and German share many cognates but with different meanings. Watch for false friends.',
  },
  'nb->sv': {
    hint: 'Norwegian and Swedish are very similar - focus on the subtle differences in vocabulary and expression rather than producing overly literal translations.',
  },
  'sv->nb': {
    hint: 'Swedish and Norwegian are very similar - focus on natural phrasing in the target language rather than word-for-word translation.',
  },

  // RTL -> LTR
  'ar->en': {
    hint: 'Arabic text may use complex verb forms that encode tense, aspect, and mood. Preserve the literary style. Right-to-left text direction should not affect the translation.',
  },
  'ar->*': {
    hint: 'Arabic verb forms encode rich morphological information. Preserve tense distinctions and the literary/colloquial register of the source.',
  },
  'he->en': {
    hint: 'Hebrew may lack vowels in the written form - disambiguate using context. Preserve the register (Biblical vs Modern Hebrew).',
  },
  'fa->en': {
    hint: 'Farsi uses Arabic script but has different grammar. Pay attention to the izafe construction and compound verbs.',
  },

  // European pairs with specific challenges
  'ru->en': {
    hint: 'Russian aspect (perfective/imperfective) carries nuance that English expresses differently. Preserve the aspectual meaning.',
  },
  'en->ru': {
    hint: 'English lacks grammatical aspect and case - choose the appropriate Russian aspect and case forms based on context.',
  },
  'fr->en': {
    hint: 'French literary style often uses longer sentences and more formal register than English. Adapt sentence structure naturally.',
  },
  'en->fr': {
    hint: 'Choose between "tu" and "vous" based on the source text register. Literary English should map to literary French.',
  },

  // Broad target cleanup for weak targets
  '*->de': {
    hint: 'German prefers concise, idiomatic phrasing. Avoid literal calques and explanatory paraphrases in the translation field; choose the most natural German noun phrase or clause.',
  },
  '*->it': {
    hint: 'Italian should read as natural literary prose. Avoid English-like word order and choose the established idiomatic equivalent rather than a literal calque.',
  },
  '*->ru': {
    hint: 'Russian should use a natural literary phrase with correct case and aspect. Avoid transliteration unless the source word is a proper noun or foreign term with no accepted Russian equivalent.',
  },
};

/**
 * Look up prompt hints for a language pair.
 * Returns hints in order of specificity: exact pair -> source wildcard -> target wildcard.
 */
export function getLanguagePairHints(sourceLanguage: string, targetLanguage: string): string {
  const hints: string[] = [];

  const exactKey = `${sourceLanguage}->${targetLanguage}` as PairKey;
  if (PAIR_HINTS[exactKey]) {
    hints.push(PAIR_HINTS[exactKey].hint);
  }

  const sourceWild = `${sourceLanguage}->*` as PairKey;
  if (PAIR_HINTS[sourceWild] && sourceWild !== exactKey) {
    hints.push(PAIR_HINTS[sourceWild].hint);
  }

  const targetWild = `*->${targetLanguage}` as PairKey;
  if (PAIR_HINTS[targetWild]) {
    hints.push(PAIR_HINTS[targetWild].hint);
  }

  return hints.length > 0 ? '\n\n' + hints.join('\n') : '';
}
