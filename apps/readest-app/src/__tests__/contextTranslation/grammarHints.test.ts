import { afterEach, describe, expect, test } from 'vitest';
import type { IpadicToken, Tokenizer } from 'kuromoji';

import { getJapaneseGrammarHint } from '@/services/contextTranslation/grammarHints';
import { _setTokenizerForTest } from '@/services/contextTranslation/plugins/jpTokenizer';

function makeToken(overrides: Partial<IpadicToken>): IpadicToken {
  return {
    surface_form: '',
    reading: undefined,
    pos: '名詞',
    pos_detail_1: '一般',
    pos_detail_2: '*',
    pos_detail_3: '*',
    conjugated_type: '*',
    conjugated_form: '*',
    basic_form: '',
    pronunciation: undefined,
    word_id: 0,
    word_type: 'KNOWN',
    word_position: 0,
    ...overrides,
  };
}

function mockTokenizer(tokenMap: Record<string, IpadicToken[]>): Tokenizer {
  return {
    tokenize(text: string): IpadicToken[] {
      return tokenMap[text] ?? [];
    },
  };
}

afterEach(() => {
  _setTokenizerForTest(null);
});

describe('getJapaneseGrammarHint', () => {
  test('maps noun details to readable labels', () => {
    _setTokenizerForTest(
      mockTokenizer({
        東京: [
          makeToken({
            surface_form: '東京',
            reading: 'トウキョウ',
            pos: '名詞',
            pos_detail_1: '固有名詞',
            pos_detail_2: '地域',
            pos_detail_3: '一般',
            conjugated_type: '*',
            conjugated_form: '*',
            basic_form: '東京',
            pronunciation: 'トーキョー',
            word_id: 1,
            word_type: 'KNOWN',
            word_position: 0,
          }),
        ],
      }),
    );

    expect(getJapaneseGrammarHint('東京')).toMatchObject({
      label: 'Noun 路 proper noun',
      pos: '名詞',
    });
  });

  test('maps adjectival noun stems to the na-adjective label', () => {
    _setTokenizerForTest(
      mockTokenizer({
        静か: [
          makeToken({
            surface_form: '静か',
            reading: 'シズカ',
            pos: '名詞',
            pos_detail_1: '形容動詞語幹',
            pos_detail_2: '*',
            pos_detail_3: '*',
            conjugated_type: '*',
            conjugated_form: '*',
            basic_form: '静か',
            pronunciation: 'シズカ',
            word_id: 2,
            word_type: 'KNOWN',
            word_position: 0,
          }),
        ],
      }),
    );

    expect(getJapaneseGrammarHint('静か')).toMatchObject({
      label: 'Noun 路 na-Adjective',
      pos: '名詞',
    });
  });

  test('builds a conjugation hint for a verb token', () => {
    _setTokenizerForTest(
      mockTokenizer({
        食べた: [
          makeToken({
            surface_form: '食べた',
            reading: 'タベタ',
            pos: '動詞',
            pos_detail_1: '非自立',
            pos_detail_2: '*',
            pos_detail_3: '*',
            conjugated_type: '一段',
            conjugated_form: '連用タ接続',
            basic_form: '食べる',
            pronunciation: 'タベタ',
            word_id: 3,
            word_type: 'KNOWN',
            word_position: 0,
          }),
        ],
      }),
    );

    expect(getJapaneseGrammarHint('食べた')).toMatchObject({
      label: 'Verb 路 dependent 路 ichidan 路 ta-conjunctive',
      pos: '動詞',
      explanation: 'Past tense of 食べる (ichidan verb). Pattern: 食べ + た',
    });
  });

  test('ignores punctuation when selecting the target token', () => {
    _setTokenizerForTest(
      mockTokenizer({
        '東京。': [
          makeToken({
            surface_form: '東京',
            reading: 'トウキョウ',
            pos: '名詞',
            pos_detail_1: '固有名詞',
            pos_detail_2: '地域',
            pos_detail_3: '一般',
            conjugated_type: '*',
            conjugated_form: '*',
            basic_form: '東京',
            pronunciation: 'トーキョー',
            word_id: 1,
            word_type: 'KNOWN',
            word_position: 0,
          }),
          makeToken({
            surface_form: '。',
            reading: undefined,
            pos: '記号',
            pos_detail_1: '句点',
            pos_detail_2: '*',
            pos_detail_3: '*',
            conjugated_type: '*',
            conjugated_form: '*',
            basic_form: '。',
            pronunciation: undefined,
            word_id: 4,
            word_type: 'KNOWN',
            word_position: 2,
          }),
        ],
      }),
    );

    expect(getJapaneseGrammarHint('東京。')).toMatchObject({
      label: 'Noun 路 proper noun',
      pos: '名詞',
    });
  });
});
