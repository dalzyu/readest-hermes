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
