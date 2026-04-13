/**
 * Grammar hint generation for the translation/dictionary popup.
 *
 * Japanese: deterministic POS analysis via kuromoji (no LLM needed).
 * Other languages: returns null 鈥?grammar hints come from the LLM field instead.
 */
import { isTokenizerReady, tokenizeRaw } from './plugins/jpTokenizer';
import type { IpadicToken } from 'kuromoji';

// Japanese POS \u922b?English label lookup
const POS_LABELS: Record<string, string> = {
  '\u935a\u5d88\ue7fb': 'Noun',
  '\u9355\u66e1\ue7fb': 'Verb',
  '\u8930\u3220\ue190\u746d?': 'i-Adjective',
  '\u8930\u3220\ue190\u9355\u66e1\ue7fb': 'na-Adjective',
  '\u9353\ue21d\ue7fb': 'Adverb',
  '\u95ab\uff44\u7d8b\u746d?': 'Prenominal',
  '\u93ba\u30e7\u7a13\u746d?': 'Conjunction',
  '\u93b0\u71b7\u5aca\u746d?': 'Interjection',
  '\u9354\u2544\ue7fb': 'Particle',
  '\u9354\u2541\u5aca\u746d?': 'Auxiliary',
  '\u93ba\u30e9\u7260\u746d?': 'Prefix',
  '\u7477\u6a3a\u5f7f': 'Symbol',
  '\u9289\u66d8\u5045\u9289\u253f\u5157': 'Filler',
};

const POS_DETAIL_LABELS: Record<string, string> = {
  '\u6d93\u20ac\u9478?': '',
  '\u9477\ue046\u73db': '',
  '\u95c8\u70b6\u569c\u7ed4?': 'dependent',
  '\u93ba\u30e5\u71ac': 'suffix',
  '\u93c1?': 'numeral',
  '\u9365\u70d8\u6e41\u935a\u5d88\ue7fb': 'proper noun',
  '\u6d60\uff45\u6095\u746d?': 'pronoun',
  '\u9353\ue21d\ue7fb\u9359\ue21d\u5158': 'adverbial',
  '\u9288\u975b\ue62e\u93ba\u30e7\u7a13': 'suru-verb',
  '\u8930\u3220\ue190\u9355\u66e1\ue7fb\u747e\u70b2\u6784': 'na-adj stem',
  '\u9289\u5a3f\u5046\u8930\u3220\ue190\u746d\u70b6\u736e\u9a9e?': 'nai-adj stem',
  '\u93cd\u714e\u59ea\u746d?': 'case particle',
  '\u6dc7\u509a\u59ea\u746d?': 'binding particle',
  '\u9353\ue21a\u59ea\u746d?': 'adverbial particle',
  '\u93ba\u30e7\u7a13\u9354\u2544\ue7fb': 'conjunctive particle',
  '\u7ef2\u509a\u59ea\u746d?': 'sentence-final particle',
  '\u95ab\uff44\u7d8b\u9356?': 'adnominal',
  '\u5bee\u66e0\u6564': 'quotation',
};

const CONJUGATED_FORM_LABELS: Record<string, string> = {
  '\u9369\u70d8\u6e70\u8930?': 'plain form',
  '\u95ab\uff47\u6564\u8930?': 'conjunctive',
  '\u95ab\uff47\u6564\u9288\u630e\u5e34\u7f0d?': 'ta-conjunctive',
  '\u93c8\ue046\u52a7\u8930?': 'irrealis',
  '\u93c8\ue046\u52a7\u9288\ufe3d\u5e34\u7f0d?': 'volitional base',
  '\u6d60\ue1bc\u757e\u8930?': 'conditional',
  '\u935b\u6212\u62a4\u951d?': 'imperative',
  '\u6d63\u64b9\u2588\u93ba\u30e7\u7a13': 'attributive',
  '\u6d60\ue1bc\u757e\u7efa\ue1be\u78e9\u951b?': 'contracted conditional',
  '\u9288\ue0fe\u5137\u93ba\u30e7\u7a13': 'garu-conjunctive',
  '\u95ab\uff47\u6564\u9289\u56e8\u5e34\u7f0d?': 'de-conjunctive',
};

const CONJUGATED_TYPE_LABELS: Record<string, string> = {
  '\u6d93\u20ac\u5a08?': 'ichidan',
  '\u6d5c\u65c0\ue18c\u9289\u6c47\u5052\u741b\u5c7b\u5046\u95ca\u5145\u7a76': 'godan ka-row',
  '\u6d5c\u65c0\ue18c\u9289\u6c47\u505f\u741b?': 'godan sa-row',
  '\u6d5c\u65c0\ue18c\u9289\u6c47\u506a\u741b?': 'godan ta-row',
  '\u6d5c\u65c0\ue18c\u9289\u6c47\u5115\u741b?': 'godan na-row',
  '\u6d5c\u65c0\ue18c\u9289\u6c47\u511b\u741b?': 'godan ba-row',
  '\u6d5c\u65c0\ue18c\u9289\u6c47\u512a\u741b?': 'godan ma-row',
  '\u6d5c\u65c0\ue18c\u9289\u6c47\u5135\u741b?': 'godan ra-row',
  '\u6d5c\u65c0\ue18c\u9289\u6c47\u513b\u741b\u5c7c\u7e3e\u95ca\u5145\u7a76': 'godan wa-row',
  '\u6d5c\u65c0\ue18c\u9289\u6c47\u5053\u741b?': 'godan ga-row',
  '\u9288\ue0a2\ue62e\u9289\u6c47\u5057\u9289?': 'kuru irregular',
  '\u9288\u975b\ue62e\u9289\u6c47\u5063\u9289?': 'suru irregular',
  '\u9417\u89c4\u7569\u9289\u6c47\u506a': 'ta-form',
  '\u9417\u89c4\u7569\u9289\u6c47\u5115\u9288?': 'nai-form',
  '\u9417\u89c4\u7569\u9289\u6c47\u506a\u9288?': 'tai-form',
  '\u9417\u89c4\u7569\u9289\u6c47\u5111\u9288?': 'desu',
  '\u9417\u89c4\u7569\u9289\u6c47\u512a\u9288?': 'masu',
  '\u8930\u3220\ue190\u746d\u70aa\u5153\u9288\ue76c\u504a\u9288\ue045\ue18c': 'adj auo-row',
  '\u8930\u3220\ue190\u746d\u70aa\u5153\u9288\u3086\ue18c': 'adj i-row',
  '\u6d93\u5d85\ue62e\u9356\u6827\u7037': 'uninflected',
};

// Conjugated form -> human-readable transformation name.
const FORM_EXPLANATION: Record<string, string> = {
  '\u95ab\uff47\u6564\u8930?': 'Conjunctive form',
  '\u95ab\uff47\u6564\u9288\u630e\u5e34\u7f0d?': 'Past tense',
  '\u93c8\ue046\u52a7\u8930?': 'Negative / potential base',
  '\u93c8\ue046\u52a7\u9288\ufe3d\u5e34\u7f0d?': 'Volitional',
  '\u6d60\ue1bc\u757e\u8930?': 'Conditional',
  '\u935b\u6212\u62a4\u951d?': 'Imperative',
  '\u6d63\u64b9\u2588\u93ba\u30e7\u7a13': 'Attributive',
  '\u6d60\ue1bc\u757e\u7efa\ue1be\u78e9\u951b?': 'Contracted conditional',
  '\u9288\ue0fe\u5137\u93ba\u30e7\u7a13': '-garu form',
  '\u95ab\uff47\u6564\u9289\u56e8\u5e34\u7f0d?': 'te-form (de-connection)',
};

/**
 * Build a contextual grammar explanation for a conjugated Japanese token.
 * Example: "Past tense of 椋熴伖銈?(ichidan verb). Pattern: 椋熴伖 + 銇?
 */
function buildConjugationExplanation(token: IpadicToken): string | undefined {
  if (!token.basic_form || token.basic_form === '*' || token.basic_form === token.surface_form) {
    return undefined;
  }
  if (
    !token.conjugated_form ||
    token.conjugated_form === '*' ||
    token.conjugated_form === '鍩烘湰褰?'
  ) {
    return undefined;
  }

  const formName =
    FORM_EXPLANATION[token.conjugated_form] ??
    CONJUGATED_FORM_LABELS[token.conjugated_form] ??
    token.conjugated_form;
  const posLabel = POS_LABELS[token.pos] ?? token.pos;
  const typeName =
    token.conjugated_type && token.conjugated_type !== '*'
      ? (CONJUGATED_TYPE_LABELS[token.conjugated_type] ?? token.conjugated_type)
      : '';

  let explanation = `${formName} of ${token.basic_form}`;
  if (typeName) {
    explanation += ` (${typeName} ${posLabel.toLowerCase()})`;
  } else {
    explanation += ` (${posLabel.toLowerCase()})`;
  }

  // Heuristic: derive a simple "stem + suffix" pattern from common prefix.
  const surface = token.surface_form;
  const base = token.basic_form;
  let commonLen = 0;
  while (
    commonLen < surface.length &&
    commonLen < base.length &&
    surface[commonLen] === base[commonLen]
  ) {
    commonLen++;
  }
  if (commonLen > 0 && commonLen < surface.length) {
    const stem = surface.slice(0, commonLen);
    const suffix = surface.slice(commonLen);
    explanation += `. Pattern: ${stem} + ${suffix}`;
  }

  return explanation;
}

export interface GrammarHint {
  label: string; // e.g. "Verb 路 ichidan 路 conjunctive"
  pos: string; // raw POS tag
  explanation?: string; // e.g. "Past tense of 椋熴伖銈?(ichidan). Pattern: stem + 銇?
}

/**
 * Returns a deterministic grammar hint for Japanese text via kuromoji.
 * Returns null for non-Japanese text or if the tokenizer isn't ready.
 */
export function getJapaneseGrammarHint(text: string): GrammarHint | null {
  if (!isTokenizerReady()) return null;

  const tokens: IpadicToken[] = tokenizeRaw(text);
  if (tokens.length === 0) return null;

  // For single-token: give full POS breakdown
  // For multi-token: give POS of the head token (last content word)
  const contentTokens = tokens.filter((t) => t.pos !== '瑷樺彿' && t.pos !== 'BOS/EOS');
  if (contentTokens.length === 0) return null;

  const target =
    contentTokens.length === 1 ? contentTokens[0]! : contentTokens[contentTokens.length - 1]!;

  const parts: string[] = [];

  // Main POS
  const posLabel = POS_LABELS[target.pos] ?? target.pos;
  parts.push(posLabel);

  // POS detail (if meaningful)
  if (target.pos_detail_1 && target.pos_detail_1 !== '*') {
    const detail = POS_DETAIL_LABELS[target.pos_detail_1];
    if (detail !== undefined && detail !== '') {
      parts.push(detail);
    } else if (detail === undefined) {
      parts.push(target.pos_detail_1);
    }
  }

  // Conjugation type
  if (target.conjugated_type && target.conjugated_type !== '*') {
    const typeLabel = CONJUGATED_TYPE_LABELS[target.conjugated_type] ?? target.conjugated_type;
    parts.push(typeLabel);
  }

  // Conjugated form
  if (target.conjugated_form && target.conjugated_form !== '*') {
    const formLabel = CONJUGATED_FORM_LABELS[target.conjugated_form] ?? target.conjugated_form;
    parts.push(formLabel);
  }

  return {
    label: parts.join(' 路 '),
    pos: target.pos,
    explanation: buildConjugationExplanation(target),
  };
}
