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
import { OpenAICompatibleProvider } from '@/services/ai/providers/OpenAICompatibleProvider';
import { getAIProvider } from '@/services/ai/providers';
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
});

describe('AIGatewayProvider', () => {
  test('should throw if no API key', () => {
    const config: ProviderConfig = {
      id: 'gw-test',
      name: 'AI Gateway',
      providerType: 'ai-gateway',
      baseUrl: '',
      model: 'openai/gpt-5.2',
    };

    expect(() => new AIGatewayProvider(config)).toThrow('AI Gateway API key required');
  });
});

describe('OpenAICompatibleProvider', () => {
  const baseConfig: ProviderConfig = {
    id: 'oc-test',
    name: 'OpenAI-Compatible',
    providerType: 'openai-compatible',
    baseUrl: 'http://127.0.0.1:8080',
    model: 'gemma-3-4b',
    apiKey: 'text-key',
    apiStyle: 'chat-completions',
    embeddingBaseUrl: 'http://127.0.0.1:8081',
    embeddingModel: 'embeddinggemma',
    embeddingApiKey: 'embed-key',
  };

  beforeEach(() => {
    vi.clearAllMocks();
  });

  test('uses chat completions when api style is chat-completions', () => {
    const provider = new OpenAICompatibleProvider(baseConfig);

    expect(provider.id).toBe('oc-test');
    expect(provider.getModel()).toBe('chat-model');
    expect(mockChatModel).toHaveBeenCalledWith('gemma-3-4b');
    expect(mockResponsesModel).not.toHaveBeenCalled();
  });

  test('uses responses when api style is responses', () => {
    const provider = new OpenAICompatibleProvider({
      ...baseConfig,
      apiStyle: 'responses',
    });

    expect(provider.getModel()).toBe('responses-model');
    expect(mockResponsesModel).toHaveBeenCalledWith('gemma-3-4b');
    expect(mockChatModel).not.toHaveBeenCalled();
  });

  test('uses separate embedding client settings', () => {
    const provider = new OpenAICompatibleProvider(baseConfig);

    expect(provider.getEmbeddingModel()).toBe('embedding-model');
    expect(mockEmbeddingModel).toHaveBeenCalledWith('embeddinggemma');
    expect(mockCreateOpenAI).toHaveBeenNthCalledWith(
      1,
      expect.objectContaining({
        baseURL: 'http://127.0.0.1:8080/v1',
        apiKey: 'text-key',
      }),
    );
    expect(mockCreateOpenAI).toHaveBeenNthCalledWith(
      2,
      expect.objectContaining({
        baseURL: 'http://127.0.0.1:8081/v1',
        apiKey: 'embed-key',
      }),
    );
  });
});

describe('getAIProvider', () => {
  test('should return OllamaProvider for ollama settings', () => {
    const settings: AISettings = { ...DEFAULT_AI_SETTINGS, enabled: true };
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
          model: 'openai/gpt-5.2',
          apiKey: 'test-key',
        },
      ],
      activeProviderId: 'gw-1',
    };
    const provider = getAIProvider(settings);

    expect(provider.id).toBe('gw-1');
  });

  test('should return OpenAICompatibleProvider for openai-compatible settings', () => {
    const settings: AISettings = {
      ...DEFAULT_AI_SETTINGS,
      enabled: true,
      providers: [
        {
          id: 'oc-1',
          name: 'OpenAI-Compatible',
          providerType: 'openai-compatible',
          baseUrl: 'http://127.0.0.1:8080',
          model: 'gemma-3-4b',
          embeddingBaseUrl: 'http://127.0.0.1:8081',
          embeddingModel: 'embeddinggemma',
        },
      ],
      activeProviderId: 'oc-1',
    };
    const provider = getAIProvider(settings);

    expect(provider.id).toBe('oc-1');
  });
});
