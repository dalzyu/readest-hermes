import { describe, expect, test } from 'vitest';
import {
  resolvePluginLanguage,
  detectLookupLanguage,
} from '@/services/contextTranslation/languagePolicy';

describe('resolvePluginLanguage', () => {
  test('normalizes locale tags for plugin lookup', () => {
    expect(resolvePluginLanguage('zh-Hans-CN')).toEqual([
      'zh-Hans-CN',
      'zh-Hans',
      'zh',
      'fallback',
    ]);
  });

  test('single-segment code produces language plus fallback', () => {
    expect(resolvePluginLanguage('en')).toEqual(['en', 'fallback']);
  });

  test('two-segment tag produces all prefixes plus fallback', () => {
    expect(resolvePluginLanguage('zh-Hans')).toEqual(['zh-Hans', 'zh', 'fallback']);
  });

  test('always ends with fallback sentinel', () => {
    const chain = resolvePluginLanguage('ja-JP');
    expect(chain[chain.length - 1]).toBe('fallback');
  });
});

describe('detectLookupLanguage', () => {
  test('returns detector info with language, confidence, and mixed flag', () => {
    expect(detectLookupLanguage('hello 世界')).toEqual(
      expect.objectContaining({
        language: expect.any(String),
        confidence: expect.any(Number),
        mixed: true,
      }),
    );
  });

  test('detects Chinese text without mixed flag', () => {
    const result = detectLookupLanguage('知己难逢');
    expect(result.language).toBe('zh');
    expect(result.mixed).toBe(false);
  });

  test('detects English text without mixed flag', () => {
    const result = detectLookupLanguage('knowledge is power');
    expect(result.language).toBe('en');
    expect(result.mixed).toBe(false);
  });

  test('confidence is between 0 and 1', () => {
    const result = detectLookupLanguage('bonjour le monde');
    expect(result.confidence).toBeGreaterThanOrEqual(0);
    expect(result.confidence).toBeLessThanOrEqual(1);
  });
});
