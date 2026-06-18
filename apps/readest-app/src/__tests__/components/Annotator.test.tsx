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

vi.mock('@/hooks/useContextDictionary', () => ({
  useContextDictionary: vi.fn(() => ({
    result: null,
    partialResult: null,
    loading: false,
    streaming: false,
    activeFieldId: null,
    error: null,
    aiUnavailable: false,
    expandedText: null,
    validationDecision: null,
    retrievalStatus: 'idle',
    retrievalHints: {
      currentVolumeIndexed: false,
      missingLocalIndex: false,
      missingPriorVolumes: [],
      missingSeriesAssignment: false,
    },
    popupContext: null,
    examples: [],
    annotations: null,
    debugInfo: null,
    availabilityHint: null,
    fieldProvenance: null,
    saveToVocabulary: vi.fn(),
  })),
}));

vi.mock('@/app/reader/hooks/useOpenAIInNotebook', () => ({
  useOpenAIInNotebook: () => ({ openAIInNotebook: vi.fn(), closeAIInNotebook: vi.fn() }),
}));

// We just test that ContextDictionaryPopup can be imported
// (since Annotator is too complex to unit test here)
describe('ContextDictionaryPopup integration', () => {
  test('ContextDictionaryPopup is importable and is a React component', async () => {
    const mod = await import('@/app/reader/components/annotator/ContextDictionaryPopup');
    expect(typeof mod.default).toBe('function');
  });
});
