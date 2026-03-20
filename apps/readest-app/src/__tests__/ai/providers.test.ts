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
import type { AISettings } from '@/services/ai/types';
import { DEFAULT_AI_SETTINGS } from '@/services/ai/constants';

describe('OllamaProvider', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  test('should create provider with default settings', () => {
    const settings: AISettings = { ...DEFAULT_AI_SETTINGS, enabled: true };
    const provider = new OllamaProvider(settings);

    expect(provider.id).toBe('ollama');
    expect(provider.name).toBe('Ollama (Local)');
    expect(provider.requiresAuth).toBe(false);
  });

  test('isAvailable should return true when Ollama responds', async () => {
    mockFetch.mockResolvedValueOnce({ ok: true });
    const settings: AISettings = { ...DEFAULT_AI_SETTINGS, enabled: true };
    const provider = new OllamaProvider(settings);

    const result = await provider.isAvailable();
    expect(result).toBe(true);
  });
});

describe('AIGatewayProvider', () => {
  test('should throw if no API key', () => {
    const settings: AISettings = { ...DEFAULT_AI_SETTINGS, enabled: true, provider: 'ai-gateway' };

    expect(() => new AIGatewayProvider(settings)).toThrow('AI Gateway API key required');
  });
});

describe('OpenAICompatibleProvider', () => {
  const baseSettings: AISettings = {
    ...DEFAULT_AI_SETTINGS,
    enabled: true,
    provider: 'openai-compatible',
    openAICompatibleApiStyle: 'chat-completions',
    openAICompatibleBaseUrl: 'http://127.0.0.1:8080',
    openAICompatibleModel: 'gemma-3-4b',
    openAICompatibleApiKey: 'text-key',
    openAICompatibleEmbeddingBaseUrl: 'http://127.0.0.1:8081',
    openAICompatibleEmbeddingModel: 'embeddinggemma',
    openAICompatibleEmbeddingApiKey: 'embed-key',
  };

  beforeEach(() => {
    vi.clearAllMocks();
  });

  test('uses chat completions when api style is chat-completions', () => {
    const provider = OpenAICompatibleProvider.fromSettings(baseSettings);

    expect(provider.id).toBe('openai-compatible');
    expect(provider.getModel()).toBe('chat-model');
    expect(mockChatModel).toHaveBeenCalledWith('gemma-3-4b');
    expect(mockResponsesModel).not.toHaveBeenCalled();
  });

  test('uses responses when api style is responses', () => {
    const provider = OpenAICompatibleProvider.fromSettings({
      ...baseSettings,
      openAICompatibleApiStyle: 'responses',
    });

    expect(provider.getModel()).toBe('responses-model');
    expect(mockResponsesModel).toHaveBeenCalledWith('gemma-3-4b');
    expect(mockChatModel).not.toHaveBeenCalled();
  });

  test('uses separate embedding client settings', () => {
    const provider = OpenAICompatibleProvider.fromSettings(baseSettings);

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
  test('should return OllamaProvider for ollama', () => {
    const settings: AISettings = { ...DEFAULT_AI_SETTINGS, enabled: true, provider: 'ollama' };
    const provider = getAIProvider(settings);

    expect(provider.id).toBe('ollama');
  });

  test('should return AIGatewayProvider for ai-gateway', () => {
    const settings: AISettings = {
      ...DEFAULT_AI_SETTINGS,
      enabled: true,
      provider: 'ai-gateway',
      aiGatewayApiKey: 'test-key',
    };
    const provider = getAIProvider(settings);

    expect(provider.id).toBe('ai-gateway');
  });

  test('should return OpenAICompatibleProvider for openai-compatible', () => {
    const settings: AISettings = {
      ...DEFAULT_AI_SETTINGS,
      enabled: true,
      provider: 'openai-compatible',
      openAICompatibleBaseUrl: 'http://127.0.0.1:8080',
      openAICompatibleModel: 'gemma-3-4b',
      openAICompatibleEmbeddingBaseUrl: 'http://127.0.0.1:8081',
      openAICompatibleEmbeddingModel: 'embeddinggemma',
    };
    const provider = getAIProvider(settings);

    expect(provider.id).toBe('openai-compatible');
  });
});
