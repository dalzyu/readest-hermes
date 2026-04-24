import { describe, expect, test, vi } from 'vitest';

const { mockInitJapaneseTokenizer } = vi.hoisted(() => ({
  mockInitJapaneseTokenizer: vi.fn().mockResolvedValue(undefined),
}));

vi.mock('@/services/contextTranslation/plugins/jpTokenizer', async () => {
  const actual = await vi.importActual<
    typeof import('@/services/contextTranslation/plugins/jpTokenizer')
  >('@/services/contextTranslation/plugins/jpTokenizer');
  return {
    ...actual,
    initJapaneseTokenizer: mockInitJapaneseTokenizer,
  };
});

import { resolveLookupPlugins } from '@/services/contextTranslation/plugins/registry';

describe('resolveLookupPlugins', () => {
  test('does not eagerly start tokenizer loading when registry is imported', () => {
    expect(mockInitJapaneseTokenizer).not.toHaveBeenCalled();
  });

  test('resolves target and source plugins independently', () => {
    const resolved = resolveLookupPlugins({
      sourceLanguage: 'zh-Hans',
      targetLanguage: 'en-US',
      mode: 'translation',
    });
    expect(resolved.source.language).toBe('zh');
    expect(resolved.target.language).toBe('en');
  });

  test('falls back to fallback plugin for unknown language', () => {
    const resolved = resolveLookupPlugins({
      sourceLanguage: 'xyz',
      targetLanguage: 'xyz',
      mode: 'translation',
    });
    expect(resolved.source.language).toBe('fallback');
    expect(resolved.target.language).toBe('fallback');
  });

  test('handles und source language gracefully', () => {
    const resolved = resolveLookupPlugins({
      sourceLanguage: 'und',
      targetLanguage: 'en',
      mode: 'translation',
    });
    expect(resolved.source.language).toBe('fallback');
    expect(resolved.target.language).toBe('en');
  });
});
