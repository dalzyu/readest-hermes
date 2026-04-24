import { renderHook, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, test, vi } from 'vitest';

const {
  mockRunLookupPipeline,
  mockUseSettingsStore,
  mockUseAuth,
  mockUseReaderStore,
  mockSaveLookupHistoryEntry,
  mockSaveVocabularyEntry,
  mockEventDispatcherDispatch,
} = vi.hoisted(() => ({
  mockRunLookupPipeline: vi.fn(),
  mockUseSettingsStore: vi.fn(),
  mockUseAuth: vi.fn(),
  mockUseReaderStore: Object.assign(vi.fn(), { getState: vi.fn() }),
  mockSaveLookupHistoryEntry: vi.fn(),
  mockSaveVocabularyEntry: vi.fn().mockResolvedValue(undefined),
  mockEventDispatcherDispatch: vi.fn().mockResolvedValue(undefined),
}));

vi.mock('@/services/contextTranslation/lookupPipeline', () => ({
  runLookupPipeline: (...args: unknown[]) => mockRunLookupPipeline(...args),
}));

vi.mock('@/store/settingsStore', () => ({
  useSettingsStore: (...args: unknown[]) => mockUseSettingsStore(...args),
}));

vi.mock('@/store/readerStore', () => ({
  useReaderStore: mockUseReaderStore,
}));

vi.mock('@/context/AuthContext', () => ({
  useAuth: () => mockUseAuth(),
}));

vi.mock('@/services/contextTranslation/lookupHistoryService', () => ({
  saveLookupHistoryEntry: (...args: unknown[]) => mockSaveLookupHistoryEntry(...args),
}));

vi.mock('@/services/contextTranslation/vocabularyService', () => ({
  saveVocabularyEntry: (...args: unknown[]) => mockSaveVocabularyEntry(...args),
}));

vi.mock('@/utils/event', () => ({
  eventDispatcher: {
    dispatch: (...args: unknown[]) => mockEventDispatcherDispatch(...args),
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
    mockUseReaderStore.getState.mockReturnValue({
      getProgress: vi.fn().mockReturnValue({
        location: 'epubcfi(/6/4!/4/2/1:0)',
      }),
    });

    mockRunLookupPipeline.mockResolvedValue({
      fields: { translation: 'close friend' },
      fieldProvenance: { translation: { source: 'ai' } },
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

  test('passes the current reader location into lookup history saves', async () => {
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

    await waitFor(() => expect(mockSaveLookupHistoryEntry).toHaveBeenCalledTimes(1));

    expect(mockSaveLookupHistoryEntry).toHaveBeenCalledWith(
      expect.objectContaining({
        bookHash: 'book-hash',
        term: '知己',
        mode: 'translation',
        location: 'epubcfi(/6/4!/4/2/1:0)',
      }),
    );
  });

  test('saves vocabulary and emits a vocabulary update event for the current book', async () => {
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

    await waitFor(() => expect(result.current.result?.['translation']).toBe('close friend'));
    await result.current.saveToVocabulary();

    expect(mockSaveVocabularyEntry).toHaveBeenCalledWith(
      expect.objectContaining({
        bookHash: 'book-hash',
        term: '知己',
        context: 'context text',
        mode: 'translation',
      }),
    );
    expect(mockEventDispatcherDispatch).toHaveBeenCalledWith('vocabulary-updated', {
      bookHash: 'book-hash',
    });
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
          fieldProvenance: { translation: { source: 'ai' } },
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
