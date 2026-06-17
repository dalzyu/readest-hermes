import { streamText } from 'ai';
import { getProviderForTask } from '../providers';
import { buildInferenceOptions } from '../inferenceParams';
import { isBookIndexed, vectorSearch } from '../ragService';
import { aiLogger } from '../logger';
import { buildSystemPrompt } from '../prompts';
import type { AIMessage, AISettings, ScoredChunk } from '../types';

let lastSources: ScoredChunk[] = [];

export interface ChatStreamInput {
  messages: AIMessage[];
  bookHash: string;
  bookTitle: string;
  aiSettings: AISettings;
  signal?: AbortSignal;
}

export function getLastSources(): ScoredChunk[] {
  return lastSources;
}

export function clearLastSources(): void {
  lastSources = [];
}

async function* streamViaApiRoute(
  messages: Array<{ role: 'user' | 'assistant'; content: string }>,
  systemPrompt: string,
  apiKey: string,
  modelId: string,
  inferenceParams: Record<string, unknown>,
  signal?: AbortSignal,
): AsyncGenerator<string> {
  const response = await fetch('/api/ai/chat', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      messages,
      system: systemPrompt,
      apiKey,
      model: modelId,
      inferenceParams,
    }),
    signal,
  });
  if (!response.ok) throw new Error(`Chat failed: ${response.status}`);
  const reader = response.body!.getReader();
  const decoder = new TextDecoder();
  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    yield decoder.decode(value, { stream: true });
  }
  const finalChunk = decoder.decode();
  if (finalChunk) yield finalChunk;
}

export async function streamChat(
  input: ChatStreamInput,
  onToken: (token: string) => void,
): Promise<AIMessage> {
  const { provider, modelId, inferenceParams, config } = getProviderForTask(
    input.aiSettings,
    'chat',
  );
  const lastUserMessage = [...input.messages].reverse().find((message) => message.role === 'user');
  const query = lastUserMessage?.content ?? '';
  let chunks: ScoredChunk[] = [];

  aiLogger.chat.send(query.length, false);
  if (await isBookIndexed(input.bookHash)) {
    try {
      chunks = await vectorSearch(
        input.bookHash,
        query,
        input.aiSettings,
        input.aiSettings.maxContextChunks || 5,
        undefined,
        query,
      );
      lastSources = chunks;
      aiLogger.chat.context(chunks.length, chunks.map((chunk) => chunk.text).join('').length);
    } catch (error) {
      lastSources = [];
      aiLogger.chat.error(`RAG failed: ${(error as Error).message}`);
    }
  }

  const systemPrompt = buildSystemPrompt(input.bookTitle, '', chunks, 0);
  const messages = input.messages.map((message) => ({
    role: message.role,
    content: message.content,
  }));
  let text = '';

  if (typeof window !== 'undefined' && config.providerType === 'ai-gateway') {
    for await (const token of streamViaApiRoute(
      messages,
      systemPrompt,
      config.apiKey ?? '',
      modelId,
      inferenceParams as Record<string, unknown>,
      input.signal,
    )) {
      text += token;
      onToken(token);
    }
  } else {
    const result = streamText({
      model: provider.getModel(modelId, inferenceParams),
      system: systemPrompt,
      messages,
      abortSignal: input.signal,
      ...buildInferenceOptions(inferenceParams),
    });
    for await (const token of result.textStream) {
      text += token;
      onToken(token);
    }
  }

  aiLogger.chat.complete(text.length);
  return {
    id: crypto.randomUUID(),
    conversationId: input.messages[0]?.conversationId ?? '',
    role: 'assistant',
    content: text,
    createdAt: Date.now(),
  };
}
