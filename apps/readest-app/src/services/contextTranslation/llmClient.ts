import { generateText, streamText } from 'ai';
import type { LanguageModel } from 'ai';
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
    ...(params?.temperature != null && { temperature: params.temperature }),
    ...(params?.maxTokens != null && { maxTokens: params.maxTokens }),
    ...(params?.topP != null && { topP: params.topP }),
    ...(params?.frequencyPenalty != null && { frequencyPenalty: params.frequencyPenalty }),
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
    ...(params?.temperature != null && { temperature: params.temperature }),
    ...(params?.maxTokens != null && { maxTokens: params.maxTokens }),
    ...(params?.topP != null && { topP: params.topP }),
    ...(params?.frequencyPenalty != null && { frequencyPenalty: params.frequencyPenalty }),
  });

  for await (const chunk of result.textStream) {
    yield chunk;
  }
}
