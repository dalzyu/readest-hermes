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
}));

import { buildPopupContextBundle } from '@/services/contextTranslation/popupRetrievalService';
import { runContextLookup } from '@/services/contextTranslation/contextLookupService';
import { saveLookupHistoryEntry } from '@/services/contextTranslation/lookupHistoryService';
import { useContextLookup } from '@/hooks/useContextLookup';
import type { PopupContextBundle } from '@/services/contextTranslation/types';
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
