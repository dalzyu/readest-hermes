import { describe, test, expect, vi, beforeEach } from 'vitest';
import { renderHook, waitFor, act } from '@testing-library/react';

import type {
  ContextTranslationSettings,
  PopupContextBundle,
  TranslationOutputField,
} from '@/services/contextTranslation/types';

vi.mock('@/services/contextTranslation/popupRetrievalService', () => ({
  buildPopupContextBundle: vi.fn(),
}));
vi.mock('@/services/contextTranslation/vocabularyService', () => ({
  saveVocabularyEntry: vi.fn(),
}));
vi.mock('@/store/settingsStore', () => ({
  useSettingsStore: () => ({ settings: null }),
}));
vi.mock('@/services/ai/providers', () => ({
  getAIProvider: () => ({ getModel: () => 'mock-model' }),
  getProviderForTask: () => ({
    provider: { getModel: () => 'mock-model' },
    inferenceParams: {},
  }),
}));
vi.mock('@/services/contextTranslation/contextLookupService', () => ({
  runContextLookup: vi.fn(),
  buildContextLookupTelemetryPayload: vi.fn(),
  contextLookupTelemetry: { logOutcome: vi.fn() },
}));

vi.mock('@/services/contextTranslation/simpleLookup', () => ({
  runSimpleLookup: vi.fn(),
}));
vi.mock('@/context/AuthContext', () => ({
  useAuth: () => ({ token: null }),
}));
vi.mock('@/services/contextTranslation/translationService', () => ({
  streamTranslationWithContext: vi.fn(function* () {
    yield {
      fields: { translation: '' },
      activeFieldId: 'translation',
      rawText: '<translation></translation>',
      done: false,
    };
    yield {
      fields: { translation: 'close friend', contextualMeaning: 'a deeply trusted companion' },
      activeFieldId: null,
      rawText:
        '<lookup_json>{"translation":"close friend","contextualMeaning":"a deeply trusted companion"}</lookup_json>',
      done: true,
    };
  }),
  streamLookupWithContext: vi.fn(function* () {}),
  streamPerFieldTranslation: vi.fn(function* () {}),
  finalizeTranslationWithContext: vi
    .fn()
    .mockImplementation(async (_request, _model, _signal, existing) => ({
      fields: existing?.initialFields ?? {
        translation: 'close friend',
        contextualMeaning: 'a deeply trusted companion',
      },
      rawText:
        existing?.initialRawText ??
        '<lookup_json>{"translation":"close friend","contextualMeaning":"a deeply trusted companion"}</lookup_json>',
    })),
}));

import { buildPopupContextBundle } from '@/services/contextTranslation/popupRetrievalService';
import { runContextLookup } from '@/services/contextTranslation/contextLookupService';
import { saveVocabularyEntry } from '@/services/contextTranslation/vocabularyService';
import { useContextTranslation } from '@/hooks/useContextTranslation';

const fields: TranslationOutputField[] = [
  {
    id: 'translation',
    label: 'Translation',
    enabled: true,
    order: 0,
    promptInstruction: 'Provide a direct translation.',
  },
  {
    id: 'contextualMeaning',
    label: 'Contextual Meaning',
    enabled: true,
    order: 1,
    promptInstruction: 'Explain contextual meaning.',
  },
];

const settings: ContextTranslationSettings = {
  enabled: true,
  targetLanguage: 'en',
  recentContextPages: 3,
  lookAheadWords: 80,
  sameBookRagEnabled: true,
  priorVolumeRagEnabled: true,
  sameBookChunkCount: 3,
  priorVolumeChunkCount: 2,
  outputFields: fields,
};

const defaultProps = {
  bookKey: 'book-key-1',
  bookHash: 'hash-abc',
  selectedText: '知己',
  currentPage: 5,
  settings,
};

const popupContextBundle: PopupContextBundle = {
  localPastContext: 'He found a true 知己 among companions.',
  localFutureBuffer: 'The next line clarifies the relationship.',
  sameBookChunks: ['Earlier in the same volume, 知己 described a sworn confidant.'],
  priorVolumeChunks: ['Volume 1 used 知己 during a reunion scene.'],
  dictionaryEntries: [],
  retrievalStatus: 'cross-volume',
  retrievalHints: {
    currentVolumeIndexed: true,
    missingLocalIndex: false,
    missingPriorVolumes: [],
    missingSeriesAssignment: false,
  },
};

beforeEach(() => {
  vi.clearAllMocks();
  vi.mocked(buildPopupContextBundle).mockResolvedValue(popupContextBundle);
  vi.mocked(runContextLookup).mockResolvedValue({
    fields: {
      translation: 'close friend',
      contextualMeaning: 'A soulmate who truly understands you.',
    },
    examples: [],
    annotations: {},
    validationDecision: 'accept',
    detectedLanguage: { language: 'zh', confidence: 0.9, mixed: false },
  });
  vi.mocked(saveVocabularyEntry).mockResolvedValue({
    id: 'saved-id',
    bookHash: 'hash-abc',
    term: '知己',
    context: popupContextBundle.localPastContext,
    result: { translation: 'close friend' },
    addedAt: Date.now(),
    reviewCount: 0,
  });
});

describe('useContextTranslation', () => {
  test('starts in loading state and resolves with translation result', async () => {
    const { result } = renderHook(() => useContextTranslation(defaultProps));

    expect(result.current.loading).toBe(true);
    expect(result.current.result).toBeNull();

    await waitFor(() => expect(result.current.loading).toBe(false));

    expect(result.current.result).toEqual({
      translation: 'close friend',
      contextualMeaning: 'A soulmate who truly understands you.',
    });
    expect(result.current.error).toBeNull();
  });

  test('builds the popup context bundle before translating', async () => {
    renderHook(() => useContextTranslation(defaultProps));

    await waitFor(() =>
      expect(vi.mocked(buildPopupContextBundle).mock.calls.length).toBeGreaterThan(0),
    );

    expect(buildPopupContextBundle).toHaveBeenCalledWith(
      expect.objectContaining({
        bookHash: 'hash-abc',
        currentPage: 5,
        selectedText: '知己',
        settings,
      }),
    );
  });

  test('passes the popup context bundle into the shared lookup service', async () => {
    renderHook(() => useContextTranslation(defaultProps));

    await waitFor(() => expect(vi.mocked(runContextLookup).mock.calls.length).toBeGreaterThan(0));

    const callArg = vi.mocked(runContextLookup).mock.calls[0]![0];
    expect(callArg.selectedText).toBe('知己');
    expect(callArg.popupContext).toEqual(popupContextBundle);
    expect(callArg.targetLanguage).toBe('en');
    expect(callArg.mode).toBe('translation');
  });

  test('sets error when lookup fails', async () => {
    vi.mocked(runContextLookup).mockRejectedValueOnce(new Error('LLM unavailable'));

    const { result } = renderHook(() => useContextTranslation(defaultProps));

    await waitFor(() => expect(result.current.loading).toBe(false));

    expect(result.current.error).toContain('LLM unavailable');
    expect(result.current.result).toBeNull();
  });

  test('saveToVocabulary persists result with lookup metadata', async () => {
    const { result } = renderHook(() => useContextTranslation(defaultProps));

    await waitFor(() => expect(result.current.loading).toBe(false));

    await act(async () => {
      await result.current.saveToVocabulary();
    });

    expect(saveVocabularyEntry).toHaveBeenCalledWith(
      expect.objectContaining({
        bookHash: 'hash-abc',
        term: '知己',
        context: popupContextBundle.localPastContext,
        mode: 'translation',
        sourceLanguage: 'zh',
        targetLanguage: 'en',
        result: {
          translation: 'close friend',
          contextualMeaning: 'A soulmate who truly understands you.',
        },
      }),
    );
  });

  test('re-fetches when selectedText changes', async () => {
    const { result, rerender } = renderHook(
      (props: typeof defaultProps) => useContextTranslation(props),
      { initialProps: defaultProps },
    );

    await waitFor(() => expect(result.current.loading).toBe(false));
    expect(vi.mocked(runContextLookup)).toHaveBeenCalledTimes(1);

    rerender({ ...defaultProps, selectedText: '朋友' });

    await waitFor(() => expect(vi.mocked(runContextLookup)).toHaveBeenCalledTimes(2));
    const secondCall = vi.mocked(runContextLookup).mock.calls[1]![0];
    expect(secondCall.selectedText).toBe('朋友');
  });

  test('restarts translation when currentPage changes for the same popup request', async () => {
    const { result, rerender } = renderHook(
      (props: typeof defaultProps) => useContextTranslation(props),
      { initialProps: defaultProps },
    );

    await waitFor(() => expect(result.current.loading).toBe(false));
    expect(vi.mocked(runContextLookup)).toHaveBeenCalledTimes(1);

    rerender({ ...defaultProps, currentPage: 6 });

    await new Promise((resolve) => setTimeout(resolve, 50));

    expect(vi.mocked(runContextLookup)).toHaveBeenCalledTimes(2);
  });

  test('does not translate when selectedText is empty', async () => {
    renderHook(() => useContextTranslation({ ...defaultProps, selectedText: '' }));

    await new Promise((resolve) => setTimeout(resolve, 50));

    expect(runContextLookup).not.toHaveBeenCalled();
  });

  test('waits for the popup context bundle before lookup begins', async () => {
    let resolveContext: (value: PopupContextBundle) => void = () => {};

    vi.mocked(buildPopupContextBundle).mockImplementation(
      () =>
        new Promise<PopupContextBundle>((resolve) => {
          resolveContext = resolve;
        }),
    );

    renderHook(() => useContextTranslation(defaultProps));

    await waitFor(() => expect(buildPopupContextBundle).toHaveBeenCalledTimes(1));
    expect(runContextLookup).not.toHaveBeenCalled();

    resolveContext(popupContextBundle);

    await waitFor(() => expect(runContextLookup).toHaveBeenCalledTimes(1));
  });

  test('shared lookup returns the final result after streaming', async () => {
    const { result } = renderHook(() => useContextTranslation(defaultProps));

    await waitFor(() => expect(result.current.result?.['translation']).toBe('close friend'));
    // partialResult reflects the last streamed chunk (done: true yields final fields)
    expect(result.current.partialResult).not.toBeNull();
    expect(result.current.activeFieldId).toBeNull();
    expect(result.current.streaming).toBe(false);
    // After stream completes, runContextLookup is called for post-stream repair/enrichment
    expect(runContextLookup).toHaveBeenCalled();
  });
});
