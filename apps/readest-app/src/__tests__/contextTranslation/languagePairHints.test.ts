import { describe, expect, test } from 'vitest';

import { getLanguagePairHints } from '@/services/contextTranslation/languagePairHints';

describe('getLanguagePairHints', () => {
  test('emits exact, source wildcard, then target wildcard hints in order', () => {
    const hints = getLanguagePairHints('en', 'ru');
    const lines = hints.trim().split('\n');

    expect(lines).toHaveLength(3);
    expect(lines[0]).toContain('English lacks grammatical aspect and case');
    expect(lines[1]).toContain('English source text often hides idioms');
    expect(lines[2]).toContain('Russian should use a natural literary phrase');
  });

  test('does not instruct Hindi-source translations to transliterate the source text', () => {
    const hints = getLanguagePairHints('hi', 'en');

    expect(hints).not.toMatch(/IAST|romanization|romanize|transliterate/i);
  });
});
