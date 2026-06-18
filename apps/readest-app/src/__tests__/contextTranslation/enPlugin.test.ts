import { describe, expect, test } from 'vitest';
import { enPlugin } from '@/services/learning/plugins/enPlugin';

describe('enPlugin', () => {
  test('language is en', () => {
    expect(enPlugin.language).toBe('en');
  });
});
