import { streamText } from 'ai';
import type { ChatModelAdapter, ChatModelRunResult } from '@assistant-ui/react';
import { getProviderForTask } from '../providers';
import { hybridSearch, isBookIndexed } from '../ragService';
import { aiLogger } from '../logger';
import { buildSystemPrompt } from '../prompts';
import type { AISettings, ScoredChunk } from '../types';

let lastSources: ScoredChunk[] = [];

export function getLastSources(): ScoredChunk[] {
  return lastSources;
}

export function clearLastSources(): void {
  lastSources = [];
}

interface TauriAdapterOptions {
  settings: AISettings;
  bookHash: string;
  bookTitle: string;
  authorName: string;
  currentPage: number;
}

function extractSeededPopupSection(content: string, label: string): string {
  const escapedLabel = label.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const pattern = new RegExp(
    `(?:^|\\n\\n)${escapedLabel}:\\n([\\s\\S]*?)(?=\\n\\n[^\\n]+:\\n|$)`,
    'i',
  );
  return content.match(pattern)?.[1]?.trim() ?? '';
}

function buildRetrievalQuery(content: string): string {
  const selection = extractSeededPopupSection(content, 'Selection');
  const translation = extractSeededPopupSection(content, 'translation');
  const question = extractSeededPopupSection(content, 'Question');

  const seededQuery = [selection, translation, question].filter(Boolean).join('\n');
  return seededQuery || content;
}

async function* streamViaApiRoute(
  messages: Array<{ role: string; content: string }>,
  systemPrompt: string,
  settings: AISettings,
  abortSignal?: AbortSignal,
): AsyncGenerator<string> {
  // Find the active AI Gateway provider config to get apiKey and model
  const gatewayConfig = settings.providers.find(
    (p) => p.id === settings.activeProviderId && p.providerType === 'ai-gateway',
  );
  const response = await fetch('/api/ai/chat', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      messages,
      system: systemPrompt,
      apiKey: gatewayConfig?.apiKey ?? '',
      model: gatewayConfig?.model || 'google/gemini-2.5-flash-lite',
    }),
    signal: abortSignal,
  });

  if (!response.ok) {
    const error = await response.json().catch(() => ({ error: 'Unknown error' }));
    throw new Error(error.error || `Chat failed: ${response.status}`);
  }

  const reader = response.body!.getReader();
  const decoder = new TextDecoder();

  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    yield decoder.decode(value, { stream: true });
  }
}

export function createTauriAdapter(getOptions: () => TauriAdapterOptions): ChatModelAdapter {
  return {
    async *run({ messages, abortSignal }): AsyncGenerator<ChatModelRunResult> {
      const options = getOptions();
      const { settings, bookHash, bookTitle, authorName, currentPage } = options;
      const { provider, inferenceParams } = getProviderForTask(settings, 'chat');
      let chunks: ScoredChunk[] = [];

      const lastUserMessage = [...messages].reverse().find((m) => m.role === 'user');
      const query =
        lastUserMessage?.content
          ?.filter((c) => c.type === 'text')
          .map((c) => c.text)
          .map((text) => buildRetrievalQuery(text))
          .join(' ') || '';

      aiLogger.chat.send(query.length, false);

      if (await isBookIndexed(bookHash)) {
        try {
          chunks = await hybridSearch(
            bookHash,
            query,
            settings,
            settings.maxContextChunks || 5,
            settings.spoilerProtection ? currentPage : undefined,
          );
          aiLogger.chat.context(chunks.length, chunks.map((c) => c.text).join('').length);
          lastSources = chunks;
        } catch (e) {
          aiLogger.chat.error(`RAG failed: ${(e as Error).message}`);
          lastSources = [];
        }
      } else {
        lastSources = [];
      }

      const systemPrompt = buildSystemPrompt(bookTitle, authorName, chunks, currentPage);

      const aiMessages = messages.map((m) => ({
        role: m.role as 'user' | 'assistant',
        content: m.content
          .filter((c) => c.type === 'text')
          .map((c) => c.text)
          .join('\n'),
      }));

      try {
        const useApiRoute = typeof window !== 'undefined' && settings.providers.some(p => p.id === settings.activeProviderId && p.providerType === 'ai-gateway');

        let text = '';

        if (useApiRoute) {
          for await (const chunk of streamViaApiRoute(
            aiMessages,
            systemPrompt,
            settings,
            abortSignal,
          )) {
            text += chunk;
            yield { content: [{ type: 'text', text }] };
          }
        } else {
          const result = streamText({
            model: provider.getModel(inferenceParams),
            system: systemPrompt,
            messages: aiMessages,
            abortSignal,
          });

          for await (const chunk of result.textStream) {
            text += chunk;
            yield { content: [{ type: 'text', text }] };
          }
        }

        aiLogger.chat.complete(text.length);
      } catch (error) {
        if ((error as Error).name !== 'AbortError') {
          aiLogger.chat.error((error as Error).message);
          throw error;
        }
      }
    },
  };
}
