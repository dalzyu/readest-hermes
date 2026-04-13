import { describe, expect, test } from 'vitest';
import { zhPlugin } from '@/services/contextTranslation/plugins/zhPlugin';

describe('zhPlugin', () => {
  test('provides pinyin annotation for Chinese selected text', () => {
    const annotations = zhPlugin.enrichSourceAnnotations?.({ translation: 'close friend' }, '知己');
    expect(annotations?.phonetic).toBeDefined();
    expect(annotations?.phonetic).toContain('zhī');
  });

  test('language is zh', () => {
    expect(zhPlugin.language).toBe('zh');
  });
});
