import { describe, expect, test, afterEach } from 'vitest';
import { jaPlugin } from '@/services/contextTranslation/plugins/jaPlugin';
import { _setTokenizerForTest } from '@/services/contextTranslation/plugins/jpTokenizer';
import type { IpadicToken, Tokenizer } from 'kuromoji';

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

describe('jaPlugin', () => {
  test('provides romaji annotation for selected Japanese kana text', () => {
    const annotations = jaPlugin.enrichSourceAnnotations?.({}, 'きっぷ');

    expect(annotations?.phonetic).toBe('kippu');
  });

  test('extends katakana long vowels in romaji output', () => {
    const annotations = jaPlugin.enrichSourceAnnotations?.({}, 'ゲーム');

    expect(annotations?.phonetic).toBe('geemu');
  });

  test('returns undefined for kanji text when tokenizer not loaded', () => {
    // Without kuromoji, kanji text cannot be romanized deterministically
    const annotations = jaPlugin.enrichSourceAnnotations?.({}, '食べる');

    expect(annotations).toBeUndefined();
  });

  test('returns undefined for pure kanji text when tokenizer not loaded', () => {
    const annotations = jaPlugin.enrichSourceAnnotations?.({}, '東京');

    expect(annotations).toBeUndefined();
  });

  test('romanizes kanji text when kuromoji tokenizer is available', () => {
    _setTokenizerForTest(
      mockTokenizer({
        食べる: [
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

    const annotations = jaPlugin.enrichSourceAnnotations?.({}, '食べる');
    expect(annotations?.phonetic).toBe('taberu');
  });

  test('romanizes kanji in examples when tokenizer is available', () => {
    _setTokenizerForTest(
      mockTokenizer({
        食べ物: [
          {
            surface_form: '食べ物',
            reading: 'タベモノ',
            pos: '名詞',
            pos_detail_1: '一般',
            pos_detail_2: '*',
            pos_detail_3: '*',
            conjugated_type: '*',
            conjugated_form: '*',
            basic_form: '食べ物',
            pronunciation: 'タベモノ',
            word_id: 5,
            word_type: 'KNOWN',
            word_position: 0,
          },
        ],
      }),
    );

    const annotations = jaPlugin.enrichExampleAnnotations?.(
      [{ exampleId: '1', sourceText: '食べ物', targetText: 'food' }],
      'source',
    );

    expect(annotations?.['1']?.phonetic).toBe('tabemono');
  });

  test('adds phonetic annotations to example text', () => {
    const annotations = jaPlugin.enrichExampleAnnotations?.(
      [{ exampleId: '1', sourceText: 'スーパー', targetText: 'supermarket' }],
      'source',
    );

    expect(annotations?.['1']?.phonetic).toBe('suupaa');
  });

  test('skips example annotations for kanji when tokenizer not loaded', () => {
    const annotations = jaPlugin.enrichExampleAnnotations?.(
      [{ exampleId: '1', sourceText: '食べ物', targetText: 'food' }],
      'source',
    );

    expect(annotations).toBeUndefined();
  });

  test('language is ja', () => {
    expect(jaPlugin.language).toBe('ja');
  });
});
