import { beforeEach, describe, expect, test, vi } from 'vitest';
import { createTauriAdapter } from '@/services/ai/adapters/TauriChatAdapter';

const mocks = vi.hoisted(() => ({
  fetch: vi.fn(),
  streamText: vi.fn(),
  getProviderForTask: vi.fn(),
  isBookIndexed: vi.fn(),
  vectorSearch: vi.fn(),
  buildSystemPrompt: vi.fn(),
  aiLogger: {
    chat: {
      send: vi.fn(),
      context: vi.fn(),
      error: vi.fn(),
      complete: vi.fn(),
    },
  },
}));

vi.stubGlobal('fetch', mocks.fetch);

vi.mock('ai', () => ({
  streamText: (...args: unknown[]) => mocks.streamText(...args),
}));

vi.mock('@/services/ai/providers', () => ({
  getProviderForTask: (...args: unknown[]) => mocks.getProviderForTask(...args),
}));

vi.mock('@/services/ai/ragService', () => ({
  isBookIndexed: (...args: unknown[]) => mocks.isBookIndexed(...args),
  vectorSearch: (...args: unknown[]) => mocks.vectorSearch(...args),
}));

vi.mock('@/services/ai/prompts', () => ({
  buildSystemPrompt: (...args: unknown[]) => mocks.buildSystemPrompt(...args),
}));

vi.mock('@/services/ai/logger', () => ({
  aiLogger: mocks.aiLogger,
}));

describe('TauriChatAdapter', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  test('forwards mapped reasoning options to direct-provider chats', async () => {
    const getModel = vi.fn(() => 'direct-model');
    mocks.getProviderForTask.mockReturnValue({
      provider: {
        id: 'openai-test',
        name: 'OpenAI',
        providerType: 'openai',
        requiresAuth: true,
        getModel,
        getEmbeddingModel: vi.fn(),
        isAvailable: vi.fn(),
        healthCheck: vi.fn(),
      },
      modelId: 'gpt-4o-mini',
      inferenceParams: {
        temperature: 0.2,
        reasoningEffort: 'off',
      },
      config: {
        id: 'openai-test',
        name: 'OpenAI',
        providerType: 'openai',
        baseUrl: 'https://api.openai.com/v1',
        apiKey: 'test-key',
        models: [{ id: 'gpt-4o-mini', kind: 'chat' }],
      },
    });
    mocks.isBookIndexed.mockResolvedValue(false);
    mocks.buildSystemPrompt.mockReturnValue('system prompt');
    mocks.streamText.mockReturnValue({
      textStream: (async function* () {
        yield 'OK';
      })(),
    });

    const adapter = createTauriAdapter(() => ({
      settings: {} as never,
      bookHash: 'book-1',
      bookTitle: 'Book',
      authorName: 'Author',
      currentPage: 12,
    }));

    const outputs: string[] = [];
    const stream = adapter.run({
      messages: [
        {
          role: 'user',
          content: [{ type: 'text', text: 'hello' }],
        },
      ],
      abortSignal: undefined,
    } as never) as unknown as AsyncIterable<{ content?: Array<{ text?: string }> }>;

    for await (const result of stream) {
      outputs.push(result.content?.[0]?.text ?? '');
    }

    expect(getModel).toHaveBeenCalledWith('gpt-4o-mini', {
      temperature: 0.2,
      reasoningEffort: 'off',
    });
    expect(mocks.streamText).toHaveBeenCalledWith(
      expect.objectContaining({
        model: 'direct-model',
        system: 'system prompt',
        messages: [{ role: 'user', content: 'hello' }],
        temperature: 0.2,
        providerOptions: {
          openai: { reasoningEffort: 'none' },
          openrouter: { reasoningEffort: 'none' },
        },
      }),
    );
    expect(
      (mocks.streamText.mock.calls[0]?.[0] as Record<string, unknown>)['reasoningEffort'],
    ).toBeUndefined();
    expect(outputs).toEqual(['OK']);
  });

  test('flushes the gateway UTF-8 decoder at EOF', async () => {
    const getModel = vi.fn(() => 'gateway-model');
    mocks.getProviderForTask.mockReturnValue({
      provider: {
        id: 'gateway-test',
        name: 'AI Gateway',
        providerType: 'ai-gateway',
        requiresAuth: true,
        getModel,
        getEmbeddingModel: vi.fn(),
        isAvailable: vi.fn(),
        healthCheck: vi.fn(),
      },
      modelId: 'google/gemini-2.5-flash-lite',
      inferenceParams: {
        temperature: 0.3,
      },
      config: {
        id: 'gateway-test',
        name: 'AI Gateway',
        providerType: 'ai-gateway',
        baseUrl: '',
        apiKey: 'test-key',
        models: [{ id: 'google/gemini-2.5-flash-lite', kind: 'chat' }],
      },
    });
    mocks.isBookIndexed.mockResolvedValue(false);
    mocks.buildSystemPrompt.mockReturnValue('system prompt');

    const encoder = new TextEncoder();
    const bytes = encoder.encode('Hi 😀');
    const truncatedBytes = bytes.slice(0, bytes.length - 1);
    const response = new Response(
      new ReadableStream<Uint8Array>({
        start(controller) {
          controller.enqueue(truncatedBytes);
          controller.close();
        },
      }),
      { status: 200 },
    );

    mocks.fetch.mockResolvedValue(response);

    const originalTextDecoder = globalThis.TextDecoder;
    const decodeCalls: Array<{ hasInput: boolean; stream?: boolean }> = [];

    class RecordingTextDecoder extends originalTextDecoder {
      override decode(input?: BufferSource, options?: TextDecodeOptions): string {
        decodeCalls.push({ hasInput: input !== undefined, stream: options?.stream });
        return super.decode(input, options);
      }
    }

    (globalThis as { TextDecoder: typeof TextDecoder }).TextDecoder =
      RecordingTextDecoder as typeof TextDecoder;

    try {
      const adapter = createTauriAdapter(() => ({
        settings: {} as never,
        bookHash: 'book-2',
        bookTitle: 'Book',
        authorName: 'Author',
        currentPage: 12,
      }));

      const outputs: string[] = [];
      const stream = adapter.run({
        messages: [
          {
            role: 'user',
            content: [{ type: 'text', text: 'hello' }],
          },
        ],
        abortSignal: undefined,
      } as never) as unknown as AsyncIterable<{ content?: Array<{ text?: string }> }>;

      for await (const result of stream) {
        outputs.push(result.content?.[0]?.text ?? '');
      }

      expect(mocks.fetch).toHaveBeenCalledWith('/api/ai/chat', expect.any(Object));
      expect(decodeCalls.at(-1)?.hasInput).toBe(false);
      expect(decodeCalls.some((call) => !call.hasInput)).toBe(true);
      expect(outputs.at(-1)).toBe('Hi �');
    } finally {
      (globalThis as { TextDecoder: typeof TextDecoder }).TextDecoder = originalTextDecoder;
    }
  });
});
