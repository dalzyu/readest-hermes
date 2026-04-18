import { describe, test, expect, vi, beforeEach } from 'vitest';

const mockFetch = vi.fn();
const mockChatModel = vi.fn(() => 'chat-model');
const mockResponsesModel = vi.fn(() => 'responses-model');
const mockEmbeddingModel = vi.fn(() => 'embedding-model');
const mockCreateOpenAI = vi.fn(() => ({
  chat: mockChatModel,
  responses: mockResponsesModel,
  embedding: mockEmbeddingModel,
}));

vi.stubGlobal('fetch', mockFetch);

vi.mock('@/services/ai/logger', () => ({
  aiLogger: {
    provider: {
      init: vi.fn(),
      error: vi.fn(),
    },
  },
}));

vi.mock('ai-sdk-ollama', () => ({
  createOllama: vi.fn(() => {
    const ollamaFn = Object.assign(vi.fn(), {
      embeddingModel: vi.fn(),
    });
    return ollamaFn;
  }),
}));

vi.mock('@ai-sdk/openai', () => ({
  createOpenAI: (...args: unknown[]) => (mockCreateOpenAI as (...a: unknown[]) => unknown)(...args),
}));

import { OllamaProvider } from '@/services/ai/providers/OllamaProvider';
import { AIGatewayProvider } from '@/services/ai/providers/AIGatewayProvider';
import { OpenAIProvider } from '@/services/ai/providers/OpenAIProvider';
import { getAIProvider, getProviderForTask } from '@/services/ai/providers';
import type { AISettings, ProviderConfig } from '@/services/ai/types';
import { DEFAULT_AI_SETTINGS, DEFAULT_OLLAMA_CONFIG } from '@/services/ai/constants';

describe('OllamaProvider', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  test('should create provider with default config', () => {
    const provider = new OllamaProvider(DEFAULT_OLLAMA_CONFIG);

    expect(provider.id).toBe('ollama-default');
    expect(provider.name).toBe('Ollama (Local)');
    expect(provider.requiresAuth).toBe(false);
  });

  test('isAvailable should return true when Ollama responds', async () => {
    mockFetch.mockResolvedValueOnce({ ok: true });
    const provider = new OllamaProvider(DEFAULT_OLLAMA_CONFIG);

    const result = await provider.isAvailable();
    expect(result).toBe(true);
  });

  test('healthCheck requires exact configured chat and embedding models', async () => {
    mockFetch.mockResolvedValueOnce({
      ok: true,
      json: async () => ({
        models: [{ name: 'llama3.2:latest' }, { name: 'nomic-embed-text:latest' }],
      }),
    });
    const provider = new OllamaProvider(DEFAULT_OLLAMA_CONFIG);

    await expect(
      provider.healthCheck({
        requireEmbedding: true,
        modelId: 'llama3.2',
        embeddingModelId: 'nomic-embed-text',
      }),
    ).resolves.toBe(true);
  });

  test('healthCheck rejects substring model matches', async () => {
    mockFetch.mockResolvedValueOnce({
      ok: true,
      json: async () => ({ models: [{ name: 'llama3.2:latest' }] }),
    });
    const provider = new OllamaProvider({
      ...DEFAULT_OLLAMA_CONFIG,
      models: [
        { id: 'llama3', kind: 'chat' },
        { id: 'nomic-embed-text', kind: 'embedding' },
      ],
    });

    await expect(provider.healthCheck()).resolves.toBe(false);
  });
});

describe('AIGatewayProvider', () => {
  test('should throw if no API key', () => {
    const config: ProviderConfig = {
      id: 'gw-test',
      name: 'AI Gateway',
      providerType: 'ai-gateway',
      baseUrl: '',
      models: [{ id: 'openai/gpt-5.2', kind: 'chat' }],
    };

    expect(() => new AIGatewayProvider(config)).toThrow('AI Gateway API key required');
  });
});

describe('OpenAIProvider', () => {
  const baseConfig: ProviderConfig = {
    id: 'oc-test',
    name: 'OpenAI-Compatible',
    providerType: 'openai',
    baseUrl: 'http://127.0.0.1:8080',
    models: [
      { id: 'gemma-3-4b', kind: 'chat' },
      { id: 'embeddinggemma', kind: 'embedding' },
    ],
    apiKey: 'text-key',
    apiStandard: 'chat-completions',
  };

  beforeEach(() => {
    vi.clearAllMocks();
  });

  test('uses chat completions when apiStandard is chat-completions', () => {
    const provider = new OpenAIProvider(baseConfig);

    expect(provider.id).toBe('oc-test');
    expect(provider.getModel('gemma-3-4b')).toBe('chat-model');
    expect(mockChatModel).toHaveBeenCalledWith('gemma-3-4b');
    expect(mockResponsesModel).not.toHaveBeenCalled();
  });

  test('uses responses when apiStandard is responses', () => {
    const provider = new OpenAIProvider({
      ...baseConfig,
      apiStandard: 'responses',
    });

    expect(provider.getModel('gemma-3-4b')).toBe('responses-model');
    expect(mockResponsesModel).toHaveBeenCalledWith('gemma-3-4b');
    expect(mockChatModel).not.toHaveBeenCalled();
  });

  test('uses embedding model from models array', () => {
    const provider = new OpenAIProvider(baseConfig);

    expect(provider.getEmbeddingModel('embeddinggemma')).toBe('embedding-model');
    expect(mockEmbeddingModel).toHaveBeenCalledWith('embeddinggemma');
    expect(mockCreateOpenAI).toHaveBeenCalledWith(
      expect.objectContaining({
        baseURL: expect.stringContaining('http://127.0.0.1:8080'),
        apiKey: 'text-key',
      }),
    );
  });
});

describe('getAIProvider', () => {
  test('should return OllamaProvider for ollama settings', () => {
    const settings: AISettings = {
      ...DEFAULT_AI_SETTINGS,
      enabled: true,
      providers: [DEFAULT_OLLAMA_CONFIG],
    };
    const provider = getAIProvider(settings);

    expect(provider.id).toBe('ollama-default');
  });

  test('should return AIGatewayProvider for ai-gateway settings', () => {
    const settings: AISettings = {
      ...DEFAULT_AI_SETTINGS,
      enabled: true,
      providers: [
        {
          id: 'gw-1',
          name: 'AI Gateway',
          providerType: 'ai-gateway',
          baseUrl: '',
          models: [{ id: 'openai/gpt-5.2', kind: 'chat' }],
          apiKey: 'test-key',
        },
      ],
    };
    const provider = getAIProvider(settings);

    expect(provider.id).toBe('gw-1');
  });

  test('should return OpenAIProvider for openai settings', () => {
    const settings: AISettings = {
      ...DEFAULT_AI_SETTINGS,
      enabled: true,
      providers: [
        {
          id: 'oc-1',
          name: 'OpenAI',
          providerType: 'openai',
          baseUrl: 'http://127.0.0.1:8080',
          models: [
            { id: 'gemma-3-4b', kind: 'chat' },
            { id: 'embeddinggemma', kind: 'embedding' },
          ],
        },
      ],
    };
    const provider = getAIProvider(settings);

    expect(provider.id).toBe('oc-1');
  });

  test('rejects embedding assignments to providers without embedding support', () => {
    const settings: AISettings = {
      ...DEFAULT_AI_SETTINGS,
      enabled: true,
      providers: [
        {
          id: 'anthropic-1',
          name: 'Anthropic',
          providerType: 'anthropic',
          baseUrl: '',
          models: [{ id: 'claude-3-5-sonnet', kind: 'chat' }],
          apiKey: 'test-key',
        },
      ],
      profiles: [
        {
          id: 'default',
          name: 'Default',
          modelAssignments: {
            embedding: { providerId: 'anthropic-1', modelId: 'claude-3-5-sonnet' },
          },
          inferenceParamsByTask: {},
        },
      ],
    };

    expect(() => getProviderForTask(settings, 'embedding')).toThrow(
      'No configured embedding model found for task: embedding',
    );
  });

  test('rejects embedding-capable providers that have no embedding model configured', () => {
    const settings: AISettings = {
      ...DEFAULT_AI_SETTINGS,
      enabled: true,
      providers: [
        {
          id: 'oc-1',
          name: 'OpenAI',
          providerType: 'openai',
          baseUrl: 'http://127.0.0.1:8080',
          models: [{ id: 'gemma-3-4b', kind: 'chat' }],
        },
      ],
      profiles: [
        {
          id: 'default',
          name: 'Default',
          modelAssignments: { embedding: { providerId: 'oc-1', modelId: 'gemma-3-4b' } },
          inferenceParamsByTask: {},
        },
      ],
    };

    expect(() => getProviderForTask(settings, 'embedding')).toThrow(
      'No configured embedding model found for task: embedding',
    );
  });
});
