import { describe, expect, test } from 'vitest';
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
