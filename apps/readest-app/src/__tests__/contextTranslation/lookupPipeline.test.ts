import { beforeEach, describe, expect, test, vi } from 'vitest';

const {
  mockBuildPopupContextBundle,
  mockConsumePrefetch,
  mockLookupDefinitions,
  mockDetectAIAvailability,
  mockResolveFieldSources,
  mockTranslateWithUpstream,
  mockMineCorpusExamples,
  mockGetProviderForTask,
  mockStreamTranslationWithContext,
  mockStreamLookupWithContext,
  mockFinalizeTranslationWithContext,
  mockRunContextLookup,
} = vi.hoisted(() => ({
  mockBuildPopupContextBundle: vi.fn(),
  mockConsumePrefetch: vi.fn(),
  mockLookupDefinitions: vi.fn(),
  mockDetectAIAvailability: vi.fn(),
  mockResolveFieldSources: vi.fn(),
  mockTranslateWithUpstream: vi.fn(),
  mockMineCorpusExamples: vi.fn(),
  mockGetProviderForTask: vi.fn(),
  mockStreamTranslationWithContext: vi.fn(),
  mockStreamLookupWithContext: vi.fn(),
  mockFinalizeTranslationWithContext: vi.fn(),
  mockRunContextLookup: vi.fn(),
}));

vi.mock('@/services/contextTranslation/popupRetrievalService', () => ({
  buildPopupContextBundle: (...args: unknown[]) => mockBuildPopupContextBundle(...args),
}));

vi.mock('@/services/contextTranslation/prefetchService', () => ({
  consumePrefetch: (...args: unknown[]) => mockConsumePrefetch(...args),
}));

vi.mock('@/services/contextTranslation/dictionaryService', () => ({
  lookupDefinitions: (...args: unknown[]) => mockLookupDefinitions(...args),
}));

vi.mock('@/services/contextTranslation/sourceRouter', () => ({
  detectAIAvailability: (...args: unknown[]) => mockDetectAIAvailability(...args),
  resolveFieldSources: (...args: unknown[]) => mockResolveFieldSources(...args),
}));

vi.mock('@/services/translators/translateWithUpstream', () => ({
  translateWithUpstream: (...args: unknown[]) => mockTranslateWithUpstream(...args),
}));

vi.mock('@/services/contextTranslation/exampleMiner', () => ({
  mineCorpusExamples: (...args: unknown[]) => mockMineCorpusExamples(...args),
}));

vi.mock('@/services/ai/providers', () => ({
  getProviderForTask: (...args: unknown[]) => mockGetProviderForTask(...args),
}));

vi.mock('@/services/contextTranslation/translationService', () => ({
  streamTranslationWithContext: (...args: unknown[]) => mockStreamTranslationWithContext(...args),
  streamLookupWithContext: (...args: unknown[]) => mockStreamLookupWithContext(...args),
  finalizeTranslationWithContext: (...args: unknown[]) =>
    mockFinalizeTranslationWithContext(...args),
}));

vi.mock('@/services/contextTranslation/contextLookupService', () => ({
  runContextLookup: (...args: unknown[]) => mockRunContextLookup(...args),
}));

import { runLookupPipeline } from '@/services/contextTranslation/lookupPipeline';
import {
  DEFAULT_CONTEXT_DICTIONARY_SETTINGS,
  DEFAULT_CONTEXT_TRANSLATION_SETTINGS,
} from '@/services/contextTranslation/defaults';
import type { AISettings } from '@/services/ai/types';
import type { PopupContextBundle } from '@/services/contextTranslation/types';

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

const translationSettings = {
  ...DEFAULT_CONTEXT_TRANSLATION_SETTINGS,
  outputFields: DEFAULT_CONTEXT_TRANSLATION_SETTINGS.outputFields.map((field) =>
    field.id === 'translation' || field.id === 'contextualMeaning'
      ? { ...field, enabled: true }
      : { ...field, enabled: false },
  ),
};

describe('runLookupPipeline', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockConsumePrefetch.mockResolvedValue(null);
    mockBuildPopupContextBundle.mockResolvedValue({ ...popupContextBundle });
    mockLookupDefinitions.mockResolvedValue([]);
    mockMineCorpusExamples.mockResolvedValue([]);
    mockTranslateWithUpstream.mockResolvedValue({ text: '', providerUsed: null });

    mockGetProviderForTask.mockReturnValue({
      provider: { getModel: () => 'mock-model' },
      modelId: 'mock-model-id',
      inferenceParams: {},
      config: {
        id: 'provider',
        name: 'provider',
        providerType: 'openai',
        baseUrl: 'http://localhost',
        models: [],
      },
    });

    mockStreamTranslationWithContext.mockImplementation(async function* () {
      yield {
        fields: { translation: 'close friend' },
        activeFieldId: 'translation',
        rawText: '<translation>close friend</translation>',
        done: true,
      };
    });

    mockStreamLookupWithContext.mockImplementation(async function* () {
      yield {
        fields: { simpleDefinition: 'trusted friend' },
        activeFieldId: 'simpleDefinition',
        rawText: '<simpleDefinition>trusted friend</simpleDefinition>',
        done: true,
      };
    });

    mockFinalizeTranslationWithContext.mockResolvedValue({
      fields: { translation: 'close friend' },
      rawText: '<translation>close friend</translation>',
    });

    mockRunContextLookup.mockResolvedValue({
      fields: {
        translation: 'close friend',
        contextualMeaning: 'trusted confidant in this scene',
      },
      examples: [],
      annotations: {},
      validationDecision: 'accept',
      detectedLanguage: { language: 'zh', confidence: 0.95, mixed: false },
    });
  });

  test('fills AI fields in translation mode and forwards pre-resolved dictionary entries once', async () => {
    mockLookupDefinitions.mockResolvedValue([
      { headword: '知己', definition: 'close friend', source: 'Dict' },
    ]);
    mockDetectAIAvailability.mockReturnValue({ chat: true, embedding: true });
    mockResolveFieldSources.mockReturnValue({
      translation: 'ai',
      contextualMeaning: 'ai',
    });

    const result = await runLookupPipeline({
      mode: 'translation',
      bookKey: 'book-key',
      bookHash: 'book-hash',
      selectedText: '知己',
      currentPage: 1,
      settings: translationSettings,
      dictionarySettings: DEFAULT_CONTEXT_DICTIONARY_SETTINGS,
      aiSettings,
      token: null,
    });

    expect(result.fields).toEqual({
      translation: 'close friend',
      contextualMeaning: 'trusted confidant in this scene',
    });
    expect(result.fieldProvenance).toEqual({
      translation: 'ai',
      contextualMeaning: 'ai',
    });
    expect(result.availabilityHint).toBe('ai-on');
    expect(mockLookupDefinitions).toHaveBeenCalledTimes(1);
    expect(mockRunContextLookup).toHaveBeenCalledWith(
      expect.objectContaining({
        preDictionaryEntries: ['知己: close friend'],
      }),
    );
  });

  test('returns translator result with ai-off-with-translator hint when chat AI is unavailable', async () => {
    mockDetectAIAvailability.mockReturnValue({ chat: false, embedding: false });
    mockResolveFieldSources.mockReturnValue({
      translation: 'translator',
      contextualMeaning: 'ai',
    });
    mockTranslateWithUpstream.mockResolvedValue({ text: 'close friend', providerUsed: 'azure' });

    const result = await runLookupPipeline({
      mode: 'translation',
      bookKey: 'book-key',
      bookHash: 'book-hash',
      selectedText: '知己',
      currentPage: 1,
      settings: translationSettings,
      dictionarySettings: DEFAULT_CONTEXT_DICTIONARY_SETTINGS,
      aiSettings,
      token: null,
    });

    expect(result.fields).toEqual({ translation: 'close friend' });
    expect(result.fieldProvenance['translation']).toBe('translator');
    expect(result.availabilityHint).toBe('ai-off-with-translator');
    expect(mockGetProviderForTask).not.toHaveBeenCalled();
    expect(mockRunContextLookup).not.toHaveBeenCalled();
  });

  test('fills dictionary-sourced dictionary fields without invoking the LLM', async () => {
    mockLookupDefinitions.mockResolvedValue([
      { headword: '知己', definition: 'trusted friend', source: 'Dict' },
    ]);
    mockDetectAIAvailability.mockReturnValue({ chat: false, embedding: false });
    mockResolveFieldSources.mockReturnValue({
      simpleDefinition: 'dictionary',
      contextualMeaning: 'ai',
      sourceExamples: 'corpus',
    });

    const result = await runLookupPipeline({
      mode: 'dictionary',
      bookKey: 'book-key',
      bookHash: 'book-hash',
      selectedText: '知己',
      currentPage: 1,
      settings: translationSettings,
      dictionarySettings: {
        ...DEFAULT_CONTEXT_DICTIONARY_SETTINGS,
        sourceExamples: false,
      },
      aiSettings,
      token: null,
    });

    expect(result.fields['simpleDefinition']).toBe('trusted friend');
    expect(result.fieldProvenance['simpleDefinition']).toBe('dictionary');
    expect(mockRunContextLookup).not.toHaveBeenCalled();
  });

  test('returns ai-off-empty when no AI or non-AI source can fill requested fields', async () => {
    mockDetectAIAvailability.mockReturnValue({ chat: false, embedding: false });
    mockResolveFieldSources.mockReturnValue({
      translation: 'ai',
      contextualMeaning: 'ai',
    });

    const result = await runLookupPipeline({
      mode: 'translation',
      bookKey: 'book-key',
      bookHash: 'book-hash',
      selectedText: '知己',
      currentPage: 1,
      settings: translationSettings,
      dictionarySettings: DEFAULT_CONTEXT_DICTIONARY_SETTINGS,
      aiSettings,
      token: null,
    });

    expect(result.fields).toEqual({});
    expect(result.availabilityHint).toBe('ai-off-empty');
    expect(mockRunContextLookup).not.toHaveBeenCalled();
  });
});
