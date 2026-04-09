import { renderHook, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, test, vi } from 'vitest';

vi.mock('@/services/contextTranslation/popupRetrievalService', () => ({
  buildPopupContextBundle: vi.fn(),
}));

vi.mock('@/services/contextTranslation/vocabularyService', () => ({
  saveVocabularyEntry: vi.fn(),
}));

vi.mock('@/store/settingsStore', () => ({
  useSettingsStore: vi.fn(() => ({ settings: null })),
}));

vi.mock('@/services/ai/providers', () => ({
  getAIProvider: () => ({ getModel: () => 'mock-model' }),
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
}));

import { buildPopupContextBundle } from '@/services/contextTranslation/popupRetrievalService';
import { runContextLookup } from '@/services/contextTranslation/contextLookupService';
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

  test('returns the final translation result', async () => {
    const { result } = renderHook(() => useContextLookup(defaultProps));
    await waitFor(() => expect(result.current.result).not.toBeNull());
    expect(result.current.result?.['translation']).toBe('close friend');
  });

  test('translation mode delegates to the shared lookup service', async () => {
    renderHook(() => useContextLookup(defaultProps));
    await waitFor(() =>
      expect(runContextLookup).toHaveBeenCalledWith(
        expect.objectContaining({ mode: 'translation' }),
      ),
    );
  });
});
