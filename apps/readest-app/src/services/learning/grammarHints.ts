import type { IpadicToken } from 'kuromoji';

import { isTokenizerReady, tokenizeRaw } from './plugins/jpTokenizer';

const POS_LABELS: Record<string, string> = {
  名詞: 'Noun',
  動詞: 'Verb',
  形容詞: 'i-Adjective',
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
  '*': '',
  一般: '',
  自立: '',
  非自立: 'dependent',
  接尾: 'suffix',
  数: 'numeral',
  固有名詞: 'proper noun',
  代名詞: 'pronoun',
  副詞可能: 'adverbial',
  サ変接続: 'suru-verb',
  形容動詞語幹: 'na-Adjective',
  ナイ形容詞語幹: 'nai-adj stem',
  形容詞接続: 'adjective-connecting',
  数接続: 'numeric-connecting',
  動詞接続: 'verb-connecting',
  名詞接続: 'noun-connecting',
  助詞類接続: 'particle-connecting',
  格助詞: 'case particle',
  係助詞: 'binding particle',
  副詞化: 'adverbial particle',
  接続詞的: 'conjunctive particle',
  終助詞: 'sentence-final particle',
  連体化: 'adnominal',
  引用文字列: 'quotation',
  読点: 'comma',
  句点: 'period',
  空白: 'space',
  括弧開: 'opening bracket',
  括弧閉: 'closing bracket',
  アルファベット: 'alphabet',
  記号: 'symbol',
  文字: 'character',
};

const CONJUGATED_FORM_LABELS: Record<string, string> = {
  基本形: 'plain form',
  連用形: 'conjunctive',
  連用タ接続: 'ta-conjunctive',
  未然形: 'irrealis',
  未然ウ接続: 'volitional base',
  仮定形: 'conditional',
  命令形: 'imperative',
  連体形: 'attributive',
  仮定縮約1: 'contracted conditional',
  ガル接続: 'garu-conjunctive',
  デ接続: 'de-conjunctive',
};

const FORM_EXPLANATION: Record<string, string> = {
  連用形: 'Conjunctive form',
  連用タ接続: 'Past tense',
  未然形: 'Negative / potential base',
  未然ウ接続: 'Volitional',
  仮定形: 'Conditional',
  命令形: 'Imperative',
  連体形: 'Attributive',
  仮定縮約1: 'Contracted conditional',
  ガル接続: '-garu form',
  デ接続: 'te-form (de-connection)',
};

const CONJUGATED_TYPE_LABELS: Record<string, string> = {
  一段: 'ichidan',
  '五段・カ行': 'godan ka-row',
  '五段・サ行': 'godan sa-row',
  '五段・タ行': 'godan ta-row',
  '五段・ナ行': 'godan na-row',
  '五段・バ行': 'godan ba-row',
  '五段・マ行': 'godan ma-row',
  '五段・ラ行': 'godan ra-row',
  '五段・ワ行促音便': 'godan wa-row',
  '五段・ガ行': 'godan ga-row',
  'カ変・クル': 'kuru irregular',
  'サ変・スル': 'suru irregular',
  '特殊・タ': 'ta-form',
  '特殊・ナイ': 'nai-form',
  '特殊・タイ': 'tai-form',
  '特殊・デス': 'desu',
  '特殊・マス': 'masu',
  '形容詞・アウオ段': 'adj auo-row',
  '形容詞・イイ': 'adj i-row',
  '形容詞・イ段': 'adj i-row',
  無活用: 'uninflected',
};

function buildConjugationExplanation(token: IpadicToken): string | undefined {
  if (!token.basic_form || token.basic_form === '*' || token.basic_form === token.surface_form) {
    return undefined;
  }

  if (!token.conjugated_form || token.conjugated_form === '*') {
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
  label: string;
  pos: string;
  explanation?: string;
}

export function getJapaneseGrammarHint(text: string): GrammarHint | null {
  if (!isTokenizerReady()) return null;

  const tokens: IpadicToken[] = tokenizeRaw(text);
  if (tokens.length === 0) return null;

  const contentTokens = tokens.filter((token) => token.pos !== '記号' && token.pos !== 'BOS/EOS');
  if (contentTokens.length === 0) return null;

  const target =
    contentTokens.length === 1 ? contentTokens[0]! : contentTokens[contentTokens.length - 1]!;

  const parts: string[] = [];

  const posLabel = POS_LABELS[target.pos] ?? target.pos;
  parts.push(posLabel);

  if (target.pos_detail_1 && target.pos_detail_1 !== '*') {
    const detail = POS_DETAIL_LABELS[target.pos_detail_1];
    if (detail !== undefined && detail !== '') {
      parts.push(detail);
    } else if (detail === undefined) {
      parts.push(target.pos_detail_1);
    }
  }

  if (target.conjugated_type && target.conjugated_type !== '*') {
    const typeLabel = CONJUGATED_TYPE_LABELS[target.conjugated_type] ?? target.conjugated_type;
    parts.push(typeLabel);
  }

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
