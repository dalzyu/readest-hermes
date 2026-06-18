import { afterEach, describe, expect, test, vi } from 'vitest';
import { detectLearningAIAvailability, lookup } from '@/services/learning/lookupService';
import { DEFAULT_AI_SETTINGS } from '@/services/ai/constants';

describe('lookupService', () => {
  test('rejects empty selections', async () => {
    await expect(
      lookup({
        bookKey: 'book',
        bookHash: 'hash',
        selectedText: ' ',
        mode: 'translation',
        targetLanguage: 'en',
      }),
    ).rejects.toThrow('Cannot look up empty selection');
  });

  test('reports disabled AI lookup availability', () => {
    expect(detectLearningAIAvailability({ ...DEFAULT_AI_SETTINGS, enabled: false })).toEqual({
      enabled: false,
      reason: 'AI is disabled',
    });
  });
});

describe('lookupService signal handling', () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  test('aborts downstream calls when the request signal is already aborted', async () => {
    const controller = new AbortController();
    controller.abort();
    const translateSpy = vi.fn();
    const lookupDefinitionsSpy = vi.fn();
    const getFrequencyBadgeSpy = vi.fn();
    vi.doMock('@/services/learning/translatorService', () => ({
      translateWithUpstream: (...args: unknown[]) => {
        translateSpy(...args);
        return Promise.resolve({ text: '', providerUsed: null });
      },
    }));
    vi.doMock('@/services/learning/dictionaryService', () => ({
      lookupDefinitions: (...args: unknown[]) => {
        lookupDefinitionsSpy(...args);
        return Promise.resolve([]);
      },
    }));
    vi.doMock('@/services/learning/frequencyService', () => ({
      getFrequencyBadge: (...args: unknown[]) => {
        getFrequencyBadgeSpy(...args);
        return undefined;
      },
    }));
    await expect(
      lookup({
        bookKey: 'book',
        bookHash: 'hash',
        selectedText: 'hello',
        mode: 'translation',
        targetLanguage: 'en',
        signal: controller.signal,
      }),
    ).rejects.toMatchObject({ name: 'AbortError' });
    expect(translateSpy).not.toHaveBeenCalled();
  });
});
