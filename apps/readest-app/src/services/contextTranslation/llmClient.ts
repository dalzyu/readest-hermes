import { generateText, streamText } from 'ai';
import type { LanguageModel } from 'ai';
import { buildInferenceOptions } from '@/services/ai/inferenceParams';
import type { InferenceParams } from '@/services/ai/types';

export async function callLLM(
  systemPrompt: string,
  userPrompt: string,
  model: LanguageModel,
  abortSignal?: AbortSignal,
  params?: InferenceParams,
): Promise<string> {
  const { text } = await generateText({
    model,
    system: systemPrompt,
    prompt: userPrompt,
    abortSignal,
    ...buildInferenceOptions(params),
  });
  return text;
}

export async function* streamLLM(
  systemPrompt: string,
  userPrompt: string,
  model: LanguageModel,
  abortSignal?: AbortSignal,
  params?: InferenceParams,
): AsyncGenerator<string> {
  const result = streamText({
    model,
    system: systemPrompt,
    prompt: userPrompt,
    abortSignal,
    ...buildInferenceOptions(params),
  });

  for await (const chunk of result.textStream) {
    yield chunk;
  }
}
