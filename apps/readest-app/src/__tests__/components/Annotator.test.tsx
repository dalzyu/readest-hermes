import { describe, expect, test } from 'vitest';

// We just test that ContextDictionaryPopup can be imported
// (since Annotator is too complex to unit test here)
describe('ContextDictionaryPopup integration', () => {
  test('ContextDictionaryPopup is importable and is a React component', async () => {
    const mod = await import('@/app/reader/components/annotator/ContextDictionaryPopup');
    expect(typeof mod.default).toBe('function');
  });
});
