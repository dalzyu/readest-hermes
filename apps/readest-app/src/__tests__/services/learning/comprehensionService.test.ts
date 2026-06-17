import { describe, expect, test } from 'vitest';
import {
  parseComprehensionResponse,
  parseShortAnswerGradingResponse,
} from '@/services/learning/comprehensionService';

describe('comprehensionService', () => {
  test('parses comprehension questions from JSON', () => {
    expect(
      parseComprehensionResponse('[{"id":"q1","type":"short-answer","question":"Why?"}]'),
    ).toEqual([expect.objectContaining({ id: 'q-0', type: 'short-answer', question: 'Why?' })]);
  });

  test('parses grading results from JSON', () => {
    expect(
      parseShortAnswerGradingResponse('[{"questionId":"q1","verdict":"correct","feedback":"ok"}]'),
    ).toEqual([{ questionId: 'q1', verdict: 'correct', feedback: 'ok' }]);
  });
});
