import { renderHook, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, test, vi } from 'vitest';

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
  useSettingsStore: vi.fn(() => ({ settings: null })),
}));

import { buildPopupContextBundle } from '@/services/contextTranslation/popupRetrievalService';
import { streamTranslationWithContext } from '@/services/contextTranslation/translationService';
import { useContextLookup } from '@/hooks/useContextLookup';
import type { PopupContextBundle } from '@/services/contextTranslation/types';
import { DEFAULT_CONTEXT_TRANSLATION_SETTINGS } from '@/services/contextTranslation/defaults';

const popupContextBundle: PopupContextBundle = {
  localPastContext: 'context text',
  localFutureBuffer: '',
  sameBookChunks: [],
  priorVolumeChunks: [],
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
  vi.mocked(streamTranslationWithContext).mockImplementation(async function* () {
    yield {
      fields: { translation: 'close friend' } as Record<string, string>,
      activeFieldId: null,
      rawText: '<translation>close friend</translation>',
      done: true,
    };
  });
});

describe('useContextLookup', () => {
  test('useContextLookup exposes mode-aware loading and validation state', async () => {
    const { result } = renderHook(() => useContextLookup(defaultProps));
    await waitFor(() => expect(result.current.loading).toBe(false));
    expect(result.current.validationDecision).toBeDefined();
  });

  test('returns the final translation result', async () => {
    const { result } = renderHook(() => useContextLookup(defaultProps));
    await waitFor(() => expect(result.current.result).not.toBeNull());
    expect(result.current.result?.['translation']).toBe('close friend');
  });
});
