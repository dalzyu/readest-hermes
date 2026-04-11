/**
 * Grammar hint generation for the translation/dictionary popup.
 *
 * Japanese: deterministic POS analysis via kuromoji (no LLM needed).
 * Other languages: returns null — grammar hints come from the LLM field instead.
 */
import { isTokenizerReady, tokenizeRaw } from './plugins/jpTokenizer';
import type { IpadicToken } from 'kuromoji';

// Japanese POS → English label lookup
const POS_LABELS: Record<string, string> = {
  名詞: 'Noun',
  動詞: 'Verb',
  形容詞: 'i-Adjective',
  形容動詞: 'na-Adjective',
  副詞: 'Adverb',
  連体詞: 'Prenominal',
  接続詞: 'Conjunction',
  感動詞: 'Interjection',
  助詞: 'Particle',
  助動詞: 'Auxiliary',
  接頭詞: 'Prefix',
  記号: 'Symbol',
  フィラー: 'Filler',
};

const POS_DETAIL_LABELS: Record<string, string> = {
  一般: '',
  自立: '',
  非自立: 'dependent',
  接尾: 'suffix',
  数: 'numeral',
  固有名詞: 'proper noun',
  代名詞: 'pronoun',
  副詞可能: 'adverbial',
  サ変接続: 'suru-verb',
  形容動詞語幹: 'na-adj stem',
  ナイ形容詞語幹: 'nai-adj stem',
  格助詞: 'case particle',
  係助詞: 'binding particle',
  副助詞: 'adverbial particle',
  接続助詞: 'conjunctive particle',
  終助詞: 'sentence-final particle',
  連体化: 'adnominal',
  引用: 'quotation',
};

const CONJUGATED_FORM_LABELS: Record<string, string> = {
  基本形: 'plain form',
  連用形: 'conjunctive',
  連用タ接続: 'ta-conjunctive',
  未然形: 'irrealis',
  未然ウ接続: 'volitional base',
  仮定形: 'conditional',
  命令ｅ: 'imperative',
  命令ｉ: 'imperative',
  体言接続: 'attributive',
  仮定縮約１: 'contracted conditional',
  ガル接続: 'garu-conjunctive',
  連用デ接続: 'de-conjunctive',
};

const CONJUGATED_TYPE_LABELS: Record<string, string> = {
  一段: 'ichidan',
  '五段・カ行イ音便': 'godan ka-row',
  '五段・サ行': 'godan sa-row',
  '五段・タ行': 'godan ta-row',
  '五段・ナ行': 'godan na-row',
  '五段・バ行': 'godan ba-row',
  '五段・マ行': 'godan ma-row',
  '五段・ラ行': 'godan ra-row',
  '五段・ワ行促音便': 'godan wa-row',
  '五段・ガ行': 'godan ga-row',
  カ変・クル: 'kuru irregular',
  サ変・スル: 'suru irregular',
  特殊・タ: 'ta-form',
  特殊・ナイ: 'nai-form',
  特殊・タイ: 'tai-form',
  特殊・デス: 'desu',
  特殊・マス: 'masu',
  形容詞・アウオ段: 'adj auo-row',
  形容詞・イ段: 'adj i-row',
  不変化型: 'uninflected',
};

// Conjugated form -> human-readable transformation name.
const FORM_EXPLANATION: Record<string, string> = {
  連用形: 'Conjunctive form',
  連用タ接続: 'Past tense',
  未然形: 'Negative / potential base',
  未然ウ接続: 'Volitional',
  仮定形: 'Conditional',
  命令ｅ: 'Imperative',
  命令ｉ: 'Imperative',
  体言接続: 'Attributive',
  仮定縮約１: 'Contracted conditional',
  ガル接続: '-garu form',
  連用デ接続: 'te-form (de-connection)',
};

/**
 * Build a contextual grammar explanation for a conjugated Japanese token.
 * Example: "Past tense of 食べる (ichidan verb). Pattern: 食べ + た"
 */
function buildConjugationExplanation(token: IpadicToken): string | undefined {
  if (!token.basic_form || token.basic_form === '*' || token.basic_form === token.surface_form) {
    return undefined;
  }
  if (!token.conjugated_form || token.conjugated_form === '*' || token.conjugated_form === '基本形') {
    return undefined;
  }

  const formName =
    FORM_EXPLANATION[token.conjugated_form] ??
    CONJUGATED_FORM_LABELS[token.conjugated_form] ??
    token.conjugated_form;
  const posLabel = POS_LABELS[token.pos] ?? token.pos;
  const typeName =
    token.conjugated_type && token.conjugated_type !== '*'
      ? CONJUGATED_TYPE_LABELS[token.conjugated_type] ?? token.conjugated_type
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
  label: string; // e.g. "Verb · ichidan · conjunctive"
  pos: string; // raw POS tag
  explanation?: string; // e.g. "Past tense of 食べる (ichidan). Pattern: stem + た"
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
  const contentTokens = tokens.filter(
    (t) => t.pos !== '記号' && t.pos !== 'BOS/EOS',
  );
  if (contentTokens.length === 0) return null;

  const target = contentTokens.length === 1
    ? contentTokens[0]!
    : contentTokens[contentTokens.length - 1]!;

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
    label: parts.join(' · '),
    pos: target.pos,
    explanation: buildConjugationExplanation(target),
  };
}
