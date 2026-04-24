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

const mockCreateOpenAICompatible = vi.fn(() => {
  const client = vi.fn((modelId: string) => `chat:${modelId}`);
  return Object.assign(client, {
    textEmbeddingModel: vi.fn((modelId: string) => `embedding:${modelId}`),
    embeddingModel: vi.fn((modelId: string) => `embedding:${modelId}`),
  });
});

vi.mock('@ai-sdk/openai-compatible', () => ({
  createOpenAICompatible: (...args: unknown[]) =>
    (mockCreateOpenAICompatible as (...a: unknown[]) => unknown)(...args),
}));

const mockCreateAnthropic = vi.fn(() => {
  const client = vi.fn((modelId: string) => `anthropic:${modelId}`);
  return client;
});

vi.mock('@ai-sdk/anthropic', () => ({
  createAnthropic: (...args: unknown[]) =>
    (mockCreateAnthropic as (...a: unknown[]) => unknown)(...args),
}));

const mockCreateGoogleGenerativeAI = vi.fn(() => {
  const client = vi.fn((modelId: string) => `google:${modelId}`);
  return Object.assign(client, {
    textEmbeddingModel: vi.fn((modelId: string) => `embedding:${modelId}`),
  });
});

vi.mock('@ai-sdk/google', () => ({
  createGoogleGenerativeAI: (...args: unknown[]) =>
    (mockCreateGoogleGenerativeAI as (...a: unknown[]) => unknown)(...args),
}));

const mockCreateOpenRouter = vi.fn(() => ({
  chat: vi.fn((modelId: string) => `openrouter:${modelId}`),
}));

vi.mock('@openrouter/ai-sdk-provider', () => ({
  createOpenRouter: (...args: unknown[]) =>
    (mockCreateOpenRouter as (...a: unknown[]) => unknown)(...args),
}));

const mockCreateGateway = vi.fn(() => {
  const gateway = vi.fn((modelId: string) => `gateway:${modelId}`);
  return Object.assign(gateway, {
    embeddingModel: vi.fn((modelId: string) => `embedding:${modelId}`),
  });
});

vi.mock('ai', () => ({
  createGateway: (...args: unknown[]) =>
    (mockCreateGateway as (...a: unknown[]) => unknown)(...args),
}));

import { OllamaProvider } from '@/services/ai/providers/OllamaProvider';
import { AIGatewayProvider } from '@/services/ai/providers/AIGatewayProvider';
import { OpenAIProvider } from '@/services/ai/providers/OpenAIProvider';
import {
  createProviderFromConfig,
  getAIProvider,
  getProviderForTask,
  GenericSdkProvider,
} from '@/services/ai/providers';
import type { AIProviderType, AISettings, ProviderConfig } from '@/services/ai/types';
import { DEFAULT_AI_SETTINGS, DEFAULT_OLLAMA_CONFIG } from '@/services/ai/constants';
import {
  AI_GATEWAY_EMBEDDING_MODEL_ALLOWLIST,
  SUPPORTED_PROVIDER_TYPES,
} from '@/services/ai/capabilities';

const GENERIC_SDK_PROVIDER_CASES = [
  {
    providerType: 'xai',
    expectedBaseURL: 'https://api.x.ai/v1',
  },
  {
    providerType: 'cohere',
    expectedBaseURL: 'https://api.cohere.ai/compatibility/v1',
  },
  {
    providerType: 'fireworks',
    expectedBaseURL: 'https://api.fireworks.ai/inference/v1',
  },
  {
    providerType: 'togetherai',
    expectedBaseURL: 'https://api.together.xyz/v1',
  },
] as const;

function buildProviderConfig(providerType: AIProviderType): ProviderConfig {
  switch (providerType) {
    case 'ollama':
      return {
        id: 'ollama-test',
        name: 'Ollama',
        providerType,
        baseUrl: 'http://127.0.0.1:11434',
        models: [{ id: 'llama3.2', kind: 'chat' }],
      };
    case 'openai':
      return {
        id: 'openai-test',
        name: 'OpenAI',
        providerType,
        baseUrl: 'http://127.0.0.1:8080',
        apiKey: 'test-key',
        apiStandard: 'chat-completions',
        models: [
          { id: 'gpt-4o-mini', kind: 'chat' },
          { id: 'text-embedding-3-small', kind: 'embedding' },
        ],
      };
    case 'anthropic':
      return {
        id: 'anthropic-test',
        name: 'Anthropic',
        providerType,
        baseUrl: 'https://api.anthropic.com',
        apiKey: 'test-key',
        models: [{ id: 'claude-3-5-sonnet', kind: 'chat' }],
      };
    case 'google':
      return {
        id: 'google-test',
        name: 'Google',
        providerType,
        baseUrl: 'https://generativelanguage.googleapis.com',
        apiKey: 'test-key',
        models: [
          { id: 'gemini-2.5-flash', kind: 'chat' },
          { id: 'gemini-embedding-001', kind: 'embedding' },
        ],
      };
    case 'openrouter':
      return {
        id: 'openrouter-test',
        name: 'OpenRouter',
        providerType,
        baseUrl: 'https://openrouter.ai/api/v1',
        apiKey: 'test-key',
        models: [{ id: 'openai/gpt-4o-mini', kind: 'chat' }],
      };
    case 'deepseek':
      return {
        id: 'deepseek-test',
        name: 'DeepSeek',
        providerType,
        baseUrl: '',
        apiKey: 'test-key',
        models: [{ id: 'deepseek-chat', kind: 'chat' }],
      };
    case 'mistral':
      return {
        id: 'mistral-test',
        name: 'Mistral',
        providerType,
        baseUrl: '',
        apiKey: 'test-key',
        models: [
          { id: 'mistral-large-latest', kind: 'chat' },
          { id: 'mistral-embed', kind: 'embedding' },
        ],
      };
    case 'groq':
      return {
        id: 'groq-test',
        name: 'Groq',
        providerType,
        baseUrl: '',
        apiKey: 'test-key',
        models: [{ id: 'llama-3.3-70b-versatile', kind: 'chat' }],
      };
    case 'xai':
      return {
        id: 'xai-test',
        name: 'xAI',
        providerType,
        baseUrl: '',
        apiKey: 'test-key',
        models: [{ id: 'grok-4.1-fast-reasoning', kind: 'chat' }],
      };
    case 'cohere':
      return {
        id: 'cohere-test',
        name: 'Cohere',
        providerType,
        baseUrl: '',
        apiKey: 'test-key',
        models: [
          { id: 'command-r', kind: 'chat' },
          { id: 'embed-multilingual-v3', kind: 'embedding' },
        ],
      };
    case 'fireworks':
      return {
        id: 'fireworks-test',
        name: 'Fireworks',
        providerType,
        baseUrl: '',
        apiKey: 'test-key',
        models: [{ id: 'accounts/fireworks/models/llama-v3p1-8b-instruct', kind: 'chat' }],
      };
    case 'togetherai':
      return {
        id: 'togetherai-test',
        name: 'Together AI',
        providerType,
        baseUrl: '',
        apiKey: 'test-key',
        models: [{ id: 'meta-llama/Llama-3.1-8B-Instruct-Turbo', kind: 'chat' }],
      };
    case 'ai-gateway':
      return {
        id: 'ai-gateway-test',
        name: 'AI Gateway',
        providerType,
        baseUrl: '',
        apiKey: 'test-key',
        models: [
          { id: 'google/gemini-2.5-flash-lite', kind: 'chat' },
          { id: AI_GATEWAY_EMBEDDING_MODEL_ALLOWLIST[0], kind: 'embedding' },
        ],
      };
    default:
      throw new Error(`Unsupported provider type in test: ${providerType}`);
  }
}

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

describe.each(GENERIC_SDK_PROVIDER_CASES)(
  'GenericSdkProvider $providerType',
  ({ providerType, expectedBaseURL }) => {
    beforeEach(() => {
      vi.clearAllMocks();
    });

    test('supports the runtime provider and resolves the expected base URL', async () => {
      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: async () => ({ data: [{ id: 'chat-model' }] }),
      });

      const provider = createProviderFromConfig({
        id: `${providerType}-test`,
        name: `${providerType} provider`,
        providerType,
        baseUrl: '',
        models: [{ id: 'chat-model', kind: 'chat' }],
        apiKey: 'test-key',
      });

      expect(GenericSdkProvider.supports(providerType)).toBe(true);
      expect(provider.providerType).toBe(providerType);
      expect(provider.getModel('chat-model')).toBe('chat:chat-model');

      await provider.healthCheck({ modelId: 'chat-model' });

      expect(mockCreateOpenAICompatible).toHaveBeenCalledWith(
        expect.objectContaining({
          apiKey: 'test-key',
          baseURL: expectedBaseURL,
        }),
      );
      expect(mockFetch).toHaveBeenCalledTimes(1);
      expect(mockFetch).toHaveBeenCalledWith(
        `${expectedBaseURL}/models`,
        expect.objectContaining({
          headers: { Authorization: 'Bearer test-key' },
        }),
      );
    });
  },
);

describe('GenericSdkProvider health check normalization', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  test('strips trailing /v1 before fetching V1 model endpoints', async () => {
    mockFetch.mockResolvedValueOnce({
      ok: true,
      json: async () => ({ data: [{ id: 'chat-model' }] }),
    });

    const provider = createProviderFromConfig({
      id: 'deepseek-v1-test',
      name: 'DeepSeek',
      providerType: 'deepseek',
      baseUrl: 'https://api.example.com/v1',
      models: [{ id: 'chat-model', kind: 'chat' }],
      apiKey: 'test-key',
    });

    await expect(provider.healthCheck({ modelId: 'chat-model' })).resolves.toBe(true);

    expect(mockFetch).toHaveBeenCalledTimes(1);
    expect(mockFetch).toHaveBeenCalledWith(
      'https://api.example.com/v1/models',
      expect.objectContaining({
        headers: { Authorization: 'Bearer test-key' },
      }),
    );
  });
});

describe.each(SUPPORTED_PROVIDER_TYPES)(
  'createProviderFromConfig supports $providerType',
  (providerType) => {
    beforeEach(() => {
      vi.clearAllMocks();
    });

    test('instantiates the runtime provider without throwing', () => {
      const provider = createProviderFromConfig(buildProviderConfig(providerType));

      expect(provider.providerType).toBe(providerType);
    });
  },
);

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
