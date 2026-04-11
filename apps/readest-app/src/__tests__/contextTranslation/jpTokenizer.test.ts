import { describe, expect, test, afterEach } from 'vitest';
import {
  getReadingRomaji,
  isTokenizerReady,
  _setTokenizerForTest,
} from '@/services/contextTranslation/plugins/jpTokenizer';
import type { Tokenizer, IpadicToken } from 'kuromoji';

/**
 * Creates a mock kuromoji tokenizer that returns pre-configured tokens.
 * This avoids loading the 17 MB dictionary in tests while exercising
 * the romaji-from-reading pipeline end to end.
 */
function mockTokenizer(tokenMap: Record<string, IpadicToken[]>): Tokenizer {
  return {
    tokenize(text: string): IpadicToken[] {
      return (
        tokenMap[text] ?? [
          {
            surface_form: text,
            reading: undefined,
            pos: '名詞',
            pos_detail_1: '一般',
            pos_detail_2: '*',
            pos_detail_3: '*',
            conjugated_type: '*',
            conjugated_form: '*',
            basic_form: text,
            pronunciation: undefined,
            word_id: 0,
            word_type: 'UNKNOWN',
            word_position: 0,
          },
        ]
      );
    },
  };
}

afterEach(() => {
  _setTokenizerForTest(null);
});

describe('jpTokenizer', () => {
  test('isTokenizerReady returns false when no tokenizer loaded', () => {
    expect(isTokenizerReady()).toBe(false);
  });

  test('isTokenizerReady returns true after mock injection', () => {
    _setTokenizerForTest(mockTokenizer({}));
    expect(isTokenizerReady()).toBe(true);
  });

  test('getReadingRomaji returns empty string when tokenizer not ready', () => {
    expect(getReadingRomaji('食べる')).toBe('');
  });

  test('romanizes kanji via katakana reading → wanakana', () => {
    _setTokenizerForTest(
      mockTokenizer({
        '食べる': [
          {
            surface_form: '食べ',
            reading: 'タベ',
            pos: '動詞',
            pos_detail_1: '自立',
            pos_detail_2: '*',
            pos_detail_3: '*',
            conjugated_type: '一段',
            conjugated_form: '連用形',
            basic_form: '食べる',
            pronunciation: 'タベ',
            word_id: 1,
            word_type: 'KNOWN',
            word_position: 0,
          },
          {
            surface_form: 'る',
            reading: 'ル',
            pos: '動詞',
            pos_detail_1: '非自立',
            pos_detail_2: '*',
            pos_detail_3: '*',
            conjugated_type: '一段',
            conjugated_form: '基本形',
            basic_form: 'る',
            pronunciation: 'ル',
            word_id: 2,
            word_type: 'KNOWN',
            word_position: 2,
          },
        ],
      }),
    );

    expect(getReadingRomaji('食べる')).toBe('taberu');
  });

  test('romanizes compound kanji word', () => {
    _setTokenizerForTest(
      mockTokenizer({
        '東京': [
          {
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
            word_id: 3,
            word_type: 'KNOWN',
            word_position: 0,
          },
        ],
      }),
    );

    expect(getReadingRomaji('東京')).toBe('toukyou');
  });

  test('passes through punctuation without reading', () => {
    _setTokenizerForTest(
      mockTokenizer({
        '東京。': [
          {
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
            word_id: 3,
            word_type: 'KNOWN',
            word_position: 0,
          },
          {
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
          },
        ],
      }),
    );

    expect(getReadingRomaji('東京。')).toBe('toukyou。');
  });
});
