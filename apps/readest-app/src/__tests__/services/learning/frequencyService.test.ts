import { describe, expect, test } from 'vitest';
import { getFrequencyBadge } from '@/services/learning/frequencyService';

describe('frequencyService', () => {
  test('loads known bundled frequency badge', () => {
    expect(getFrequencyBadge('the', 'en')).toMatchObject({ level: 'A1', source: 'bundled-sample' });
  });

  test('returns null for unknown terms', () => {
    expect(getFrequencyBadge('zzzz-not-a-word', 'en')).toBeNull();
  });
});
