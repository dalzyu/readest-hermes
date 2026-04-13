import { describe, expect, test } from 'vitest';
import { enPlugin } from '@/services/contextTranslation/plugins/enPlugin';

describe('enPlugin', () => {
  test('english plugin is a no-op for v1 annotations', () => {
    const annotations = enPlugin.enrichTargetAnnotations?.({ translation: 'hello' }, 'hello');
    expect(annotations).toBeUndefined();
  });

  test('language is en', () => {
    expect(enPlugin.language).toBe('en');
  });
});
