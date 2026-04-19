import { describe, expect, test, vi } from 'vitest';

vi.mock('@/utils/simplecc', () => ({
  initSimpleCC: vi.fn().mockResolvedValue(undefined),
  runSimpleCC: vi.fn((text: string) => text),
}));

vi.mock('@/utils/supabase', () => ({
  supabase: {
    auth: { getSession: vi.fn().mockResolvedValue({ data: { session: null } }) },
  },
}));

// We just test that ContextDictionaryPopup can be imported
// (since Annotator is too complex to unit test here)
describe('ContextDictionaryPopup integration', () => {
  test('ContextDictionaryPopup is importable and is a React component', async () => {
    const mod = await import('@/app/reader/components/annotator/ContextDictionaryPopup');
    expect(typeof mod.default).toBe('function');
  });
});
