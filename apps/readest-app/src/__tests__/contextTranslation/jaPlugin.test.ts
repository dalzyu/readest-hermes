import { describe, expect, test } from 'vitest';
import { jaPlugin } from '@/services/contextTranslation/plugins/jaPlugin';

describe('jaPlugin', () => {
  test('provides romaji annotation for selected Japanese kana text', () => {
    const annotations = jaPlugin.enrichSourceAnnotations?.({}, 'きっぷ');

    expect(annotations?.phonetic).toBe('kippu');
  });

  test('extends katakana long vowels in romaji output', () => {
    const annotations = jaPlugin.enrichSourceAnnotations?.({}, 'ゲーム');

    expect(annotations?.phonetic).toBe('geemu');
  });

  test('adds phonetic annotations to example text', () => {
    const annotations = jaPlugin.enrichExampleAnnotations?.(
      [{ exampleId: '1', sourceText: 'スーパー', targetText: 'supermarket' }],
      'source',
    );

    expect(annotations?.['1']?.phonetic).toBe('suupaa');
  });

  test('language is ja', () => {
    expect(jaPlugin.language).toBe('ja');
  });
});
