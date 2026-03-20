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
vi.mock('@/services/contextTranslation/translationService', () => ({
  streamTranslationWithContext: vi.fn(),
}));
vi.mock('@/services/contextTranslation/vocabularyService', () => ({
  saveVocabularyEntry: vi.fn(),
}));
vi.mock('@/store/settingsStore', () => ({
  useSettingsStore: () => ({ settings: null }),
}));
vi.mock('@/services/ai/providers', () => ({
  getAIProvider: () => ({ getModel: () => 'mock-model' }),
}));

import { buildPopupContextBundle } from '@/services/contextTranslation/popupRetrievalService';
import { streamTranslationWithContext } from '@/services/contextTranslation/translationService';
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
  vi.mocked(streamTranslationWithContext).mockImplementation(async function* () {
    yield {
      fields: {
        translation: 'close friend',
        contextualMeaning: 'A soulmate who truly understands you.',
      },
      activeFieldId: null,
      rawText:
        '<translation>close friend</translation><contextualMeaning>A soulmate who truly understands you.</contextualMeaning>',
      done: true,
    };
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

  test('passes the popup context bundle into streaming translation', async () => {
    renderHook(() => useContextTranslation(defaultProps));

    await waitFor(() =>
      expect(vi.mocked(streamTranslationWithContext).mock.calls.length).toBeGreaterThan(0),
    );

    const callArg = vi.mocked(streamTranslationWithContext).mock.calls[0]![0];
    expect(callArg.selectedText).toBe('知己');
    expect(callArg.popupContext).toEqual(popupContextBundle);
    expect(callArg.targetLanguage).toBe('en');
  });

  test('sets error when translation fails', async () => {
    vi.mocked(streamTranslationWithContext).mockImplementationOnce(async function* () {
      throw new Error('LLM unavailable');
    });

    const { result } = renderHook(() => useContextTranslation(defaultProps));

    await waitFor(() => expect(result.current.loading).toBe(false));

    expect(result.current.error).toContain('LLM unavailable');
    expect(result.current.result).toBeNull();
  });

  test('saveToVocabulary persists result with the local past context', async () => {
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
    expect(vi.mocked(streamTranslationWithContext)).toHaveBeenCalledTimes(1);

    rerender({ ...defaultProps, selectedText: '朋友' });

    await waitFor(() => expect(vi.mocked(streamTranslationWithContext)).toHaveBeenCalledTimes(2));
    const secondCall = vi.mocked(streamTranslationWithContext).mock.calls[1]![0];
    expect(secondCall.selectedText).toBe('朋友');
  });

  test('does not restart translation when currentPage changes for the same popup request', async () => {
    const { result, rerender } = renderHook(
      (props: typeof defaultProps) => useContextTranslation(props),
      { initialProps: defaultProps },
    );

    await waitFor(() => expect(result.current.loading).toBe(false));
    expect(vi.mocked(streamTranslationWithContext)).toHaveBeenCalledTimes(1);

    rerender({ ...defaultProps, currentPage: 6 });

    await new Promise((resolve) => setTimeout(resolve, 50));

    expect(vi.mocked(streamTranslationWithContext)).toHaveBeenCalledTimes(1);
  });

  test('does not translate when selectedText is empty', async () => {
    renderHook(() => useContextTranslation({ ...defaultProps, selectedText: '' }));

    await new Promise((resolve) => setTimeout(resolve, 50));

    expect(streamTranslationWithContext).not.toHaveBeenCalled();
  });

  test('waits for the popup context bundle before streaming translation begins', async () => {
    let resolveContext: ((value: PopupContextBundle) => void) | null = null;

    vi.mocked(buildPopupContextBundle).mockImplementation(
      () =>
        new Promise((resolve) => {
          resolveContext = resolve;
        }),
    );

    renderHook(() => useContextTranslation(defaultProps));

    await waitFor(() => expect(buildPopupContextBundle).toHaveBeenCalledTimes(1));
    expect(streamTranslationWithContext).not.toHaveBeenCalled();

    (resolveContext as ((value: PopupContextBundle) => void) | null)?.(popupContextBundle);

    await waitFor(() => expect(streamTranslationWithContext).toHaveBeenCalledTimes(1));
  });

  test('publishes partial result updates while streaming', async () => {
    let releaseFinalChunk: (() => void) | null = null;

    vi.mocked(streamTranslationWithContext).mockImplementationOnce(async function* () {
      yield {
        fields: { translation: 'close' } as Record<string, string>,
        activeFieldId: 'translation',
        rawText: '<translation>close',
        done: false,
      };
      await new Promise<void>((resolve) => {
        releaseFinalChunk = resolve;
      });
      yield {
        fields: { translation: 'close friend', contextualMeaning: 'trusted companion' } as Record<
          string,
          string
        >,
        activeFieldId: null,
        rawText:
          '<translation>close friend</translation><contextualMeaning>trusted companion</contextualMeaning>',
        done: true,
      };
    });

    const { result } = renderHook(() => useContextTranslation(defaultProps));

    await waitFor(() => expect(result.current.partialResult?.['translation']).toBe('close'));
    expect(result.current.loading).toBe(false);
    (releaseFinalChunk as (() => void) | null)?.();
    await waitFor(() => expect(result.current.result?.['translation']).toBe('close friend'));
    expect(result.current.activeFieldId).toBeNull();
  });

  test('publishes retrieval status, hints, and popup context', async () => {
    const { result } = renderHook(() => useContextTranslation(defaultProps));

    await waitFor(() => expect(result.current.loading).toBe(false));

    expect(result.current.retrievalStatus).toBe('cross-volume');
    expect(result.current.retrievalHints).toEqual(popupContextBundle.retrievalHints);
    expect(result.current.popupContext).toEqual(popupContextBundle);
  });
});
