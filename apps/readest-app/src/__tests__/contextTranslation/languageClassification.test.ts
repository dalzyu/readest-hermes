import { describe, expect, test } from 'vitest';
import { getCJKLanguage } from '@/services/contextTranslation/utils';

describe('getCJKLanguage', () => {
  test('with bookLanguage=ja returns japanese for pure kanji', () => {
    // Pure kanji text with no hiragana/katakana — ambiguous without context
    const result = getCJKLanguage('知己', '', 'ja');
    expect(result).toBe('japanese');
  });

  test('with bookLanguage=zh returns chinese for pure kanji', () => {
    const result = getCJKLanguage('知己', '', 'zh');
    expect(result).toBe('chinese');
  });

  test('without bookLanguage falls back to chinese for pure kanji', () => {
    // No page context scripts, no book language → default Chinese for Han text
    const result = getCJKLanguage('知己', '');
    expect(result).toBe('chinese');
  });

  test('with Japanese page context returns japanese regardless of bookLanguage', () => {
    // Page context has hiragana → page is Japanese, overrides bookLanguage
    const pageWithHiragana = 'この本は面白いです。';
    const result = getCJKLanguage('知己', pageWithHiragana, 'zh');
    expect(result).toBe('japanese');
  });

  test('with Korean page context returns korean', () => {
    // Page context has hangul → page is Korean
    const pageWithHangul = '한국어 텍스트입니다.';
    const result = getCJKLanguage('知己', pageWithHangul, 'ja');
    expect(result).toBe('korean');
  });

  test('text with hiragana returns japanese without page context', () => {
    const result = getCJKLanguage('おはよう', '');
    expect(result).toBe('japanese');
  });

  test('text with katakana returns japanese without page context', () => {
    const result = getCJKLanguage('カタカナ', '');
    expect(result).toBe('japanese');
  });

  test('non-CJK text returns other', () => {
    const result = getCJKLanguage('hello world', '');
    expect(result).toBe('other');
  });

  test('bookLanguage=ko returns korean for pure kanji', () => {
    const result = getCJKLanguage('知己', '', 'ko');
    expect(result).toBe('korean');
  });

  test('page context with katakana overrides bookLanguage=zh', () => {
    const pageWithKatakana = 'テスト文章です';
    const result = getCJKLanguage('漢字', pageWithKatakana, 'zh');
    expect(result).toBe('japanese');
  });
});
