import { renderHook, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, test, vi } from 'vitest';

vi.mock('@/services/contextTranslation/popupRetrievalService', () => ({
  buildPopupContextBundle: vi.fn(),
}));

vi.mock('@/services/contextTranslation/vocabularyService', () => ({
  saveVocabularyEntry: vi.fn(),
}));

vi.mock('@/services/contextTranslation/lookupHistoryService', () => ({
  saveLookupHistoryEntry: vi.fn(),
}));

vi.mock('@/store/settingsStore', () => ({
  useSettingsStore: vi.fn(() => ({ settings: null })),
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
      fields: { translation: 'close friend' },
      activeFieldId: null,
      rawText: '<lookup_json>{"translation":"close friend"}</lookup_json>',
      done: true,
    };
  }),
  streamLookupWithContext: vi.fn(function* () {
    yield {
      fields: { simpleDefinition: 'a trusted friend' },
      activeFieldId: null,
      rawText: '<lookup_json>{"simpleDefinition":"a trusted friend"}</lookup_json>',
      done: true,
    };
  }),
  finalizeTranslationWithContext: vi.fn().mockResolvedValue({
    fields: { translation: 'close friend' },
    rawText: '<translation>close friend</translation>',
  }),
}));

import { useSettingsStore } from '@/store/settingsStore';
import { buildPopupContextBundle } from '@/services/contextTranslation/popupRetrievalService';
import { runContextLookup } from '@/services/contextTranslation/contextLookupService';
import { saveLookupHistoryEntry } from '@/services/contextTranslation/lookupHistoryService';
import {
  finalizeTranslationWithContext,
  streamLookupWithContext,
} from '@/services/contextTranslation/translationService';
import { useContextLookup } from '@/hooks/useContextLookup';
import type { PopupContextBundle, TranslationResult } from '@/services/contextTranslation/types';
import { DEFAULT_CONTEXT_TRANSLATION_SETTINGS } from '@/services/contextTranslation/defaults';

const popupContextBundle: PopupContextBundle = {
  localPastContext: 'context text',
  localFutureBuffer: '',
  sameBookChunks: [],
  priorVolumeChunks: [],
  dictionaryEntries: [],
  retrievalStatus: 'local-only',
  retrievalHints: {
    currentVolumeIndexed: true,
    missingLocalIndex: false,
    missingPriorVolumes: [],
    missingSeriesAssignment: false,
  },
};

const defaultProps = {
  mode: 'translation' as const,
  bookKey: 'book-1',
  bookHash: 'hash-1',
  selectedText: '知己',
  currentPage: 1,
  settings: DEFAULT_CONTEXT_TRANSLATION_SETTINGS,
};

beforeEach(() => {
  vi.clearAllMocks();
  vi.mocked(useSettingsStore).mockReturnValue({ settings: null } as never);
  vi.mocked(buildPopupContextBundle).mockResolvedValue(popupContextBundle);
  vi.mocked(runContextLookup).mockResolvedValue({
    fields: { translation: 'close friend' },
    examples: [],
    annotations: {},
    validationDecision: 'accept',
    detectedLanguage: { language: 'zh', confidence: 0.9, mixed: false },
  });
});

describe('useContextLookup', () => {
  test('exposes mode-aware loading and validation state', async () => {
    const { result } = renderHook(() => useContextLookup(defaultProps));
    await waitFor(() => expect(result.current.loading).toBe(false));
    expect(result.current.validationDecision).toBeDefined();
  });

  test('returns the final translation result and saves history once', async () => {
    const { result } = renderHook(() => useContextLookup(defaultProps));

    await waitFor(() => expect(result.current.result).not.toBeNull());
    expect(result.current.result?.['translation']).toBe('close friend');
    expect(finalizeTranslationWithContext).toHaveBeenCalledWith(
      expect.objectContaining({
        selectedText: expect.any(String),
        harness: expect.objectContaining({
          flow: 'production',
        }),
      }),
      expect.anything(),
      expect.any(AbortSignal),
      expect.objectContaining({
        initialRawText: '<lookup_json>{"translation":"close friend"}</lookup_json>',
        initialFields: { translation: 'close friend' },
      }),
    );

    await waitFor(() => expect(saveLookupHistoryEntry).toHaveBeenCalledTimes(1));
    expect(saveLookupHistoryEntry).toHaveBeenCalledWith(
      expect.objectContaining({
        bookHash: 'hash-1',
        term: '知己',
        context: 'context text',
        mode: 'translation',
        result: { translation: 'close friend' },
      }),
    );
  });

  test('records finalized dictionary lookups too', async () => {
    vi.mocked(runContextLookup).mockResolvedValueOnce({
      fields: { simpleDefinition: 'a trusted friend' },
      examples: [],
      annotations: {},
      validationDecision: 'accept',
      detectedLanguage: { language: 'zh', confidence: 0.9, mixed: false },
    });

    renderHook(() =>
      useContextLookup({
        ...defaultProps,
        mode: 'dictionary',
      }),
    );

    await waitFor(() => expect(saveLookupHistoryEntry).toHaveBeenCalledTimes(1));
    expect(saveLookupHistoryEntry).toHaveBeenCalledWith(
      expect.objectContaining({
        mode: 'dictionary',
        result: { simpleDefinition: 'a trusted friend' },
      }),
    );
  });

  test('retains last non-empty dictionary stream fields when final chunk is empty', async () => {
    vi.mocked(streamLookupWithContext).mockImplementationOnce(async function* () {
      yield {
        fields: { simpleDefinition: 'a trusted friend' },
        activeFieldId: 'simpleDefinition',
        rawText: '<simpleDefinition>a trusted friend</simpleDefinition>',
        done: false,
      };
      yield {
        fields: {} as TranslationResult,
        activeFieldId: null,
        rawText: '<lookup_json>{}</lookup_json>',
        done: true,
      };
    });
    vi.mocked(runContextLookup).mockResolvedValueOnce({
      fields: { simpleDefinition: 'a trusted friend' },
      examples: [],
      annotations: {},
      validationDecision: 'accept',
      detectedLanguage: { language: 'zh', confidence: 0.9, mixed: false },
    });

    const { result } = renderHook(() =>
      useContextLookup({
        ...defaultProps,
        mode: 'dictionary',
      }),
    );

    await waitFor(() => expect(result.current.loading).toBe(false));
    expect(vi.mocked(runContextLookup).mock.calls.at(-1)?.[0]).toEqual(
      expect.objectContaining({
        mode: 'dictionary',
        preNormalizedFields: { simpleDefinition: 'a trusted friend' },
      }),
    );
  });

  test('captures debug info when developer mode is enabled', async () => {
    vi.mocked(useSettingsStore).mockReturnValue({
      settings: { aiSettings: { developerMode: true } },
    } as never);

    const { result } = renderHook(() => useContextLookup(defaultProps));

    await waitFor(() =>
      expect(result.current.debugInfo?.parsedResult).toEqual({ translation: 'close friend' }),
    );
    expect(result.current.debugInfo?.rawStream).toBe('<translation>close friend</translation>');
    expect(result.current.debugInfo?.systemPrompt).toContain('literary translation assistant');
    expect(result.current.debugInfo?.userPrompt).toContain('<selected_text>知己</selected_text>');
  });
  test('rebuilds lookup using expanded text when surrounding context provides boundaries', async () => {
    vi.mocked(buildPopupContextBundle).mockResolvedValue({
      ...popupContextBundle,
      localPastContext: 'Hello world',
    });

    const { result } = renderHook(() =>
      useContextLookup({
        ...defaultProps,
        selectedText: 'ello',
      }),
    );

    await waitFor(() => expect(result.current.loading).toBe(false));
    expect(result.current.expandedText).toBe('Hello');

    const bundleCallTerms = vi
      .mocked(buildPopupContextBundle)
      .mock.calls.map((call) => (call[0] as { selectedText: string }).selectedText);
    expect(bundleCallTerms).toContain('ello');
    expect(bundleCallTerms).toContain('Hello');
    expect(vi.mocked(runContextLookup).mock.calls.at(-1)?.[0]).toEqual(
      expect.objectContaining({ selectedText: 'Hello' }),
    );
  });

  test('does not record blank selections or incomplete results', async () => {
    vi.mocked(runContextLookup).mockResolvedValueOnce({
      fields: {},
      examples: [],
      annotations: {},
      validationDecision: 'accept',
      detectedLanguage: { language: 'zh', confidence: 0.9, mixed: false },
    });

    renderHook(() =>
      useContextLookup({
        ...defaultProps,
        selectedText: '   ',
      }),
    );

    await waitFor(() => expect(saveLookupHistoryEntry).not.toHaveBeenCalled());
  });
});
