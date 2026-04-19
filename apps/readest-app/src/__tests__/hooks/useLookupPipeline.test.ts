import { renderHook, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, test, vi } from 'vitest';

const { mockRunLookupPipeline, mockUseSettingsStore, mockUseAuth } = vi.hoisted(() => ({
  mockRunLookupPipeline: vi.fn(),
  mockUseSettingsStore: vi.fn(),
  mockUseAuth: vi.fn(),
}));

vi.mock('@/services/contextTranslation/lookupPipeline', () => ({
  runLookupPipeline: (...args: unknown[]) => mockRunLookupPipeline(...args),
}));

vi.mock('@/store/settingsStore', () => ({
  useSettingsStore: (...args: unknown[]) => mockUseSettingsStore(...args),
}));

vi.mock('@/context/AuthContext', () => ({
  useAuth: () => mockUseAuth(),
}));

vi.mock('@/services/contextTranslation/lookupHistoryService', () => ({
  saveLookupHistoryEntry: vi.fn(),
}));

vi.mock('@/services/contextTranslation/vocabularyService', () => ({
  saveVocabularyEntry: vi.fn(),
}));

vi.mock('@/utils/event', () => ({
  eventDispatcher: {
    dispatch: vi.fn(),
  },
}));

import { useLookupPipeline } from '@/hooks/useLookupPipeline';
import {
  DEFAULT_CONTEXT_DICTIONARY_SETTINGS,
  DEFAULT_CONTEXT_TRANSLATION_SETTINGS,
} from '@/services/contextTranslation/defaults';
import type { AISettings } from '@/services/ai/types';

const aiSettings: AISettings = {
  enabled: true,
  providers: [],
  profiles: [],
  activeProfileId: 'default',
  developerMode: false,
  spoilerProtection: true,
  maxContextChunks: 6,
  indexingMode: 'on-demand',
};

const translationSettings = {
  ...DEFAULT_CONTEXT_TRANSLATION_SETTINGS,
  outputFields: DEFAULT_CONTEXT_TRANSLATION_SETTINGS.outputFields.map((field) =>
    field.id === 'translation' ? { ...field, enabled: true } : { ...field, enabled: false },
  ),
};

describe('useLookupPipeline', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockUseAuth.mockReturnValue({ token: 'auth-token' });
    mockUseSettingsStore.mockReturnValue({
      settings: {
        aiSettings,
        translationProvider: 'azure',
      },
    });

    mockRunLookupPipeline.mockResolvedValue({
      fields: { translation: 'close friend' },
      fieldProvenance: { translation: 'ai' },
      examples: [],
      annotations: {},
      validationDecision: 'accept',
      detectedLanguage: { language: 'zh', confidence: 0.95, mixed: false },
      availabilityHint: 'ai-on',
      popupContext: {
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
      },
      expandedText: null,
      debug: null,
      retrievalStatus: 'local-only',
      retrievalHints: {
        currentVolumeIndexed: true,
        missingLocalIndex: false,
        missingPriorVolumes: [],
        missingSeriesAssignment: false,
      },
      aiUnavailable: false,
    });
  });

  test('threads auth token and preferred translation provider into runLookupPipeline', async () => {
    renderHook(() =>
      useLookupPipeline({
        mode: 'translation',
        bookKey: 'book-key',
        bookHash: 'book-hash',
        selectedText: '知己',
        currentPage: 1,
        settings: translationSettings,
        dictionarySettings: DEFAULT_CONTEXT_DICTIONARY_SETTINGS,
      }),
    );

    await waitFor(() => expect(mockRunLookupPipeline).toHaveBeenCalledTimes(1));

    expect(mockRunLookupPipeline).toHaveBeenCalledWith(
      expect.objectContaining({
        token: 'auth-token',
        preferredTranslationProvider: 'azure',
      }),
      expect.objectContaining({
        signal: expect.any(AbortSignal),
      }),
    );
  });

  test('updates partialResult from onPartial callback before final result settles', async () => {
    mockRunLookupPipeline.mockImplementationOnce(
      async (
        _request: unknown,
        options?: { onPartial?: (partial: { fields: Record<string, string> }) => void },
      ) => {
        options?.onPartial?.({ fields: { translation: 'partial value' } });

        return {
          fields: { translation: 'final value' },
          fieldProvenance: { translation: 'ai' },
          examples: [],
          annotations: {},
          validationDecision: 'accept',
          detectedLanguage: { language: 'zh', confidence: 0.95, mixed: false },
          availabilityHint: 'ai-on',
          popupContext: {
            localPastContext: '',
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
          },
          expandedText: null,
          debug: null,
          retrievalStatus: 'local-only',
          retrievalHints: {
            currentVolumeIndexed: true,
            missingLocalIndex: false,
            missingPriorVolumes: [],
            missingSeriesAssignment: false,
          },
          aiUnavailable: false,
        };
      },
    );

    const { result } = renderHook(() =>
      useLookupPipeline({
        mode: 'translation',
        bookKey: 'book-key',
        bookHash: 'book-hash',
        selectedText: '知己',
        currentPage: 1,
        settings: translationSettings,
        dictionarySettings: DEFAULT_CONTEXT_DICTIONARY_SETTINGS,
      }),
    );

    await waitFor(() =>
      expect(result.current.partialResult?.['translation']).toBe('partial value'),
    );
    await waitFor(() => expect(result.current.result?.['translation']).toBe('final value'));
  });
});
