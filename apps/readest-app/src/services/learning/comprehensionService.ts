/**
 * Reading comprehension question generator.
 *
 * Builds LLM prompts from RAG-retrieved content up to the user's current
 * reading position (spoiler-safe). Returns structured questions in
 * multiple-choice and short-answer formats.
 */

export interface ComprehensionQuestion {
  id: string;
  type: 'multiple-choice' | 'short-answer';
  question: string;
  choices?: string[];
  correctIndex?: number;
  suggestedAnswer?: string;
}

export interface ShortAnswerGradingInput {
  questionId: string;
  question: string;
  expectedAnswer: string;
  userAnswer: string;
}

export interface ShortAnswerGradeResult {
  questionId: string;
  verdict: 'correct' | 'partial' | 'incorrect';
  feedback: string;
}

export interface ComprehensionSession {
  bookHash: string;
  sectionLabel: string;
  questions: ComprehensionQuestion[];
  generatedAt: number;
}

export function buildComprehensionPrompt(
  sectionContext: string,
  sectionLabel: string,
  bookLanguage: string,
): { systemPrompt: string; userPrompt: string } {
  const systemPrompt = `You are a reading comprehension assistant. Generate questions to test a reader's understanding of the text they have read so far.

Rules:
- Only ask about events, characters, and details that appear in the provided text. Do NOT reference anything beyond it.
- Generate exactly 3 questions: 2 multiple-choice (4 options each, specify the correct option index 0-3) and 1 short-answer.
- Questions should test different levels: recall, inference, and interpretation.
- Keep questions and answers concise.
- Respond ONLY with a JSON array of question objects. Each object has:
  - "type": "multiple-choice" or "short-answer"
  - "question": the question text
  - "choices": array of 4 strings (only for multiple-choice)
  - "correctIndex": 0-3 (only for multiple-choice)
  - "suggestedAnswer": string (only for short-answer)
- Output valid JSON only. No preamble or explanation.`;

  const userPrompt = `The reader is currently at: "${sectionLabel}"

Here is the text they have read:
<reading_context>
${sectionContext}
</reading_context>

Generate 3 comprehension questions (2 multiple-choice, 1 short-answer) about this text.${
    bookLanguage && bookLanguage !== 'en'
      ? ` Write the questions in the same language as the text.`
      : ''
  }`;

  return { systemPrompt, userPrompt };
}

export function parseComprehensionResponse(raw: string): ComprehensionQuestion[] {
  try {
    // Strip markdown code fence if present
    const cleaned = raw.replace(/^```(?:json)?\s*\n?/m, '').replace(/\n?```\s*$/m, '');
    const parsed = JSON.parse(cleaned);
    if (!Array.isArray(parsed)) return [];

    return parsed
      .filter(
        (q: Record<string, unknown>) =>
          q &&
          typeof q['question'] === 'string' &&
          (q['type'] === 'multiple-choice' || q['type'] === 'short-answer'),
      )
      .map((q: Record<string, unknown>, i: number) => ({
        id: `q-${i}`,
        type: q['type'] as 'multiple-choice' | 'short-answer',
        question: q['question'] as string,
        choices: Array.isArray(q['choices']) ? (q['choices'] as string[]) : undefined,
        correctIndex: typeof q['correctIndex'] === 'number' ? q['correctIndex'] : undefined,
        suggestedAnswer:
          typeof q['suggestedAnswer'] === 'string' ? q['suggestedAnswer'] : undefined,
      }));
  } catch {
    return [];
  }
}

export function buildShortAnswerGradingPrompt(
  items: ShortAnswerGradingInput[],
  bookLanguage: string,
): { systemPrompt: string; userPrompt: string } {
  const systemPrompt = `You are grading open-ended reading comprehension answers.
Compare each learner answer to the expected answer and return constructive feedback.

Rules:
- Grade each item as one of: "correct", "partial", "incorrect".
- "correct": answer captures the required meaning with no material mistake.
- "partial": answer is partly right but misses key details or includes a minor mistake.
- "incorrect": answer is wrong, unsupported, or too vague to validate.
- Feedback must be concise (1-2 sentences), specific, and mention what to improve.
- Do not include spoilers beyond the provided expected answer.
- Return ONLY valid JSON array with objects:
  { "questionId": string, "verdict": "correct"|"partial"|"incorrect", "feedback": string }
- No markdown fences and no extra commentary.`;

  const userPrompt = `Grade the following open-ended answers.
${bookLanguage && bookLanguage !== 'en' ? 'Write feedback in the same language as the question text.' : 'Write feedback in English.'}

<grading_items_json>
${JSON.stringify(items, null, 2)}
</grading_items_json>`;

  return { systemPrompt, userPrompt };
}

export function parseShortAnswerGradingResponse(raw: string): ShortAnswerGradeResult[] {
  try {
    const cleaned = raw.replace(/^```(?:json)?\s*\n?/m, '').replace(/\n?```\s*$/m, '');
    const parsed = JSON.parse(cleaned);
    if (!Array.isArray(parsed)) return [];

    return parsed
      .filter(
        (item: Record<string, unknown>) =>
          item &&
          typeof item['questionId'] === 'string' &&
          (item['verdict'] === 'correct' ||
            item['verdict'] === 'partial' ||
            item['verdict'] === 'incorrect') &&
          typeof item['feedback'] === 'string',
      )
      .map((item: Record<string, unknown>) => ({
        questionId: item['questionId'] as string,
        verdict: item['verdict'] as 'correct' | 'partial' | 'incorrect',
        feedback: item['feedback'] as string,
      }));
  } catch {
    return [];
  }
}
