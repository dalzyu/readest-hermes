import { describe, expect, test } from 'vitest';
import { validateLookupResult } from '@/services/contextTranslation/validator';

describe('validateLookupResult', () => {
  test('accepts a result with a non-empty translation', () => {
    const result = validateLookupResult({ translation: 'bonjour' }, 'translation');
    expect(result.decision).toBe('accept');
  });

  test('degrades a result with empty translation field', () => {
    const result = validateLookupResult({ translation: '' }, 'translation');
    expect(result.decision).toBe('degrade');
  });

  test('marks echoed source text as warning when it matches a proper noun allow-rule', () => {
    // If translation equals selectedText exactly (echo), flag as warning
    const result = validateLookupResult({ translation: 'Grunnings' }, 'translation', 'Grunnings');
    expect(result.decision).toBe('accept-with-warning');
  });

  test('accepts echo for short single-char CJK (valid identical translation)', () => {
    const result = validateLookupResult({ translation: '的' }, 'translation', '的');
    expect(result.decision).toBe('accept');
  });
});
