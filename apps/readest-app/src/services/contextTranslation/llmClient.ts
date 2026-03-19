import { generateText, streamText } from 'ai';
import type { LanguageModel } from 'ai';

/**
 * Thin wrapper around the `ai` SDK for making single-turn LLM calls.
 * Accepts a pre-built system prompt and user prompt.
 *
 * In production, pass the `model` obtained from the AI provider settings.
 * In tests, this entire function is mocked.
 */
export async function callLLM(
  systemPrompt: string,
  userPrompt: string,
  model: LanguageModel,
  abortSignal?: AbortSignal,
): Promise<string> {
  const { text } = await generateText({
    model,
    system: systemPrompt,
    prompt: userPrompt,
    abortSignal,
  });
  return text;
}

export async function* streamLLM(
  systemPrompt: string,
  userPrompt: string,
  model: LanguageModel,
  abortSignal?: AbortSignal,
): AsyncGenerator<string> {
  const result = streamText({
    model,
    system: systemPrompt,
    prompt: userPrompt,
    abortSignal,
  });

  for await (const chunk of result.textStream) {
    yield chunk;
  }
}
