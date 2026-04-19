import { beforeEach, describe, expect, test, vi } from 'vitest';

const { mockGetProviderForTask } = vi.hoisted(() => ({
  mockGetProviderForTask: vi.fn(),
}));

vi.mock('@/services/ai/providers', () => ({
  getProviderForTask: (...args: unknown[]) => mockGetProviderForTask(...args),
}));

import {
  detectAIAvailability,
  resolveFieldSources,
} from '@/services/contextTranslation/sourceRouter';
import type {
  ContextDictionarySettings,
  ContextTranslationSettings,
} from '@/services/contextTranslation/types';
import type { AISettings, AITaskType } from '@/services/ai/types';

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

const translationSettings: ContextTranslationSettings = {
  enabled: true,
  targetLanguage: 'en',
  recentContextPages: 2,
  lookAheadWords: 40,
  sameBookRagEnabled: true,
  priorVolumeRagEnabled: true,
  sameBookChunkCount: 2,
  priorVolumeChunkCount: 2,
  outputFields: [],
};

const dictionarySettings: ContextDictionarySettings = {
  enabled: true,
  sourceExamples: true,
};

function setAvailableTasks(available: Partial<Record<AITaskType, boolean>>) {
  mockGetProviderForTask.mockImplementation((_settings: AISettings, task: AITaskType) => {
    if (!available[task]) {
      throw new Error(`${task} unavailable`);
    }

    return {
      provider: { getModel: () => ({}) },
      modelId: `${task}-model`,
      inferenceParams: {},
      config: {
        id: `${task}-provider`,
        name: `${task}-provider`,
        providerType: 'openai',
        baseUrl: 'http://localhost',
        models: [],
      },
    };
  });
}

describe('sourceRouter', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  test('detectAIAvailability reports false when AI is disabled', () => {
    const disabled = detectAIAvailability({ ...aiSettings, enabled: false });

    expect(disabled).toEqual({ chat: false, embedding: false });
    expect(mockGetProviderForTask).not.toHaveBeenCalled();
  });

  test('detectAIAvailability checks chat and embedding capabilities separately', () => {
    setAvailableTasks({ translation: true, embedding: false });

    const availability = detectAIAvailability(aiSettings);

    expect(availability).toEqual({ chat: true, embedding: false });
  });

  test('translation mode falls back to non-AI sources when chat is unavailable', () => {
    const sources = resolveFieldSources(
      'translation',
      {
        ...translationSettings,
        source: 'ai',
        fieldSources: {
          translation: 'ai',
          contextualMeaning: 'ai',
          examples: 'ai',
          grammarHint: 'ai',
        },
      } as ContextTranslationSettings,
      dictionarySettings,
      { chat: false, embedding: true },
    );

    expect(sources).toEqual({
      translation: 'translator',
      contextualMeaning: 'dictionary',
      examples: 'corpus',
    });
  });

  test('translation mode keeps explicit non-AI choices', () => {
    const sources = resolveFieldSources(
      'translation',
      {
        ...translationSettings,
        source: 'dictionary',
        fieldSources: {
          translation: 'dictionary',
          contextualMeaning: 'dictionary',
          examples: 'corpus',
        },
      } as ContextTranslationSettings,
      dictionarySettings,
      { chat: true, embedding: true },
    );

    expect(sources).toEqual({
      translation: 'dictionary',
      contextualMeaning: 'dictionary',
      examples: 'corpus',
      grammarHint: 'ai',
    });
  });

  test('dictionary mode routes source examples through corpus fallback when AI is unavailable', () => {
    const sources = resolveFieldSources(
      'dictionary',
      translationSettings,
      {
        ...dictionarySettings,
        fieldSources: {
          simpleDefinition: 'ai',
          contextualMeaning: 'dictionary',
          sourceExamples: 'ai',
        },
      },
      { chat: false, embedding: true },
    );

    expect(sources).toEqual({
      simpleDefinition: 'dictionary',
      contextualMeaning: 'dictionary',
      sourceExamples: 'corpus',
    });
  });
});
