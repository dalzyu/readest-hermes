import { describe, expect, test } from 'vitest';
import {
  buildShortAnswerGradingPrompt,
  parseComprehensionResponse,
  parseShortAnswerGradingResponse,
} from '@/services/contextTranslation/comprehensionService';

describe('comprehensionService', () => {
  test('parses comprehension questions from fenced JSON', () => {
    const raw = `\`\`\`json\n[
      {"type":"multiple-choice","question":"Who arrived first?","choices":["A","B","C","D"],"correctIndex":2},
      {"type":"short-answer","question":"Why did they leave?","suggestedAnswer":"Because the storm intensified."}
    ]\n\`\`\``;

    const parsed = parseComprehensionResponse(raw);
    expect(parsed).toHaveLength(2);
    expect(parsed[0]).toEqual(
      expect.objectContaining({
        type: 'multiple-choice',
        question: 'Who arrived first?',
        correctIndex: 2,
      }),
    );
    expect(parsed[1]).toEqual(
      expect.objectContaining({
        type: 'short-answer',
        suggestedAnswer: 'Because the storm intensified.',
      }),
    );
  });

  test('builds short-answer grading prompt with language guidance and payload', () => {
    const { systemPrompt, userPrompt } = buildShortAnswerGradingPrompt(
      [
        {
          questionId: 'q-1',
          question: 'What motivates the protagonist?',
          expectedAnswer: 'Protecting her family.',
          userAnswer: 'She wants to keep her family safe.',
        },
      ],
      'ja',
    );

    expect(systemPrompt).toContain('grading open-ended reading comprehension answers');
    expect(systemPrompt).toContain('"verdict"');
    expect(userPrompt).toContain('same language as the question text');
    expect(userPrompt).toContain('"questionId": "q-1"');
  });

  test('parses short-answer grading response and filters invalid entries', () => {
    const raw = `[
      {"questionId":"q-1","verdict":"correct","feedback":"Good job."},
      {"questionId":"q-2","verdict":"partial","feedback":"Mention the key event in chapter two."},
      {"questionId":"q-bad","verdict":"unknown","feedback":"invalid"}
    ]`;

    const parsed = parseShortAnswerGradingResponse(raw);
    expect(parsed).toEqual([
      { questionId: 'q-1', verdict: 'correct', feedback: 'Good job.' },
      {
        questionId: 'q-2',
        verdict: 'partial',
        feedback: 'Mention the key event in chapter two.',
      },
    ]);
  });
});
