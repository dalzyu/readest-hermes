import { describe, test, expect, vi } from 'vitest';

// mock stores and dependencies before imports
vi.mock('@/store/settingsStore', () => {
  const mockState = {
    settings: {
      aiSettings: {
        enabled: true,
        providers: [
          {
            id: 'ollama-default',
            name: 'Ollama (Local)',
            providerType: 'ollama',
            baseUrl: 'http://127.0.0.1:11434',
            model: 'llama3.2',
            embeddingModel: 'nomic-embed-text',
          },
        ],
        activeProviderId: 'ollama-default',
        modelAssignments: {},
        spoilerProtection: true,
        maxContextChunks: 5,
        indexingMode: 'on-demand',
      },
    },
    setSettings: vi.fn(),
    saveSettings: vi.fn(),
  };

  const fn = vi.fn(() => mockState) as unknown as {
    (): typeof mockState;
    getState: () => typeof mockState;
    setState: (partial: Partial<typeof mockState>) => void;
    subscribe: (listener: () => void) => () => void;
    destroy: () => void;
  };
  fn.getState = () => mockState;
  fn.setState = vi.fn();
  fn.subscribe = vi.fn();
  fn.destroy = vi.fn();

  return { useSettingsStore: fn };
});

import type { AISettings } from '@/services/ai/types';
import {
  DEFAULT_AI_SETTINGS,
  DEFAULT_OLLAMA_CONFIG,
  GATEWAY_MODELS,
} from '@/services/ai/constants';

describe('DEFAULT_AI_SETTINGS', () => {
  test('should have enabled set to false by default', () => {
    expect(DEFAULT_AI_SETTINGS.enabled).toBe(false);
  });

  test('should have ollama as default active provider', () => {
    expect(DEFAULT_AI_SETTINGS.activeProviderId).toBe('ollama-default');
    expect(DEFAULT_AI_SETTINGS.providers[0]!.providerType).toBe('ollama');
  });

  test('should have valid ollama defaults in the default provider config', () => {
    expect(DEFAULT_OLLAMA_CONFIG.baseUrl).toBe('http://127.0.0.1:11434');
    expect(DEFAULT_OLLAMA_CONFIG.model).toBe('llama3.2');
    expect(DEFAULT_OLLAMA_CONFIG.embeddingModel).toBe('nomic-embed-text');
  });

  test('should have spoiler protection enabled by default', () => {
    expect(DEFAULT_AI_SETTINGS.spoilerProtection).toBe(true);
  });
});

describe('Model constants', () => {
  test('GATEWAY_MODELS should have expected models', () => {
    expect(GATEWAY_MODELS.GEMINI_FLASH_LITE).toBeDefined();
    expect(GATEWAY_MODELS.GPT_5_NANO).toBeDefined();
    expect(GATEWAY_MODELS.LLAMA_4_SCOUT).toBeDefined();
    expect(GATEWAY_MODELS.GROK_4_1_FAST).toBeDefined();
    expect(GATEWAY_MODELS.DEEPSEEK_V3_2).toBeDefined();
    expect(GATEWAY_MODELS.QWEN_3_235B).toBeDefined();
  });
});

describe('AISettings Type', () => {
  test('should allow creating valid settings object', () => {
    const settings: AISettings = {
      ...DEFAULT_AI_SETTINGS,
      enabled: true,
      spoilerProtection: false,
      maxContextChunks: 10,
      indexingMode: 'background',
    };

    expect(settings.enabled).toBe(true);
    expect(settings.providers[0]!.providerType).toBe('ollama');
    expect(settings.indexingMode).toBe('background');
  });

  test('should support ai-gateway provider config', () => {
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
          embeddingModel: 'openai/text-embedding-3-small',
        },
      ],
      activeProviderId: 'gw-1',
    };

    expect(settings.providers[0]!.providerType).toBe('ai-gateway');
    expect(settings.providers[0]!.apiKey).toBe('test-key');
  });

  test('should support openai-compatible provider with api style and separate embedding config', () => {
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
          apiKey: 'text-key',
          apiStyle: 'chat-completions',
          embeddingBaseUrl: 'http://127.0.0.1:8081',
          embeddingModel: 'embeddinggemma',
          embeddingApiKey: 'embed-key',
        },
      ],
      activeProviderId: 'oc-1',
    };

    expect(settings.providers[0]!.providerType).toBe('openai-compatible');
    expect(settings.providers[0]!.apiStyle).toBe('chat-completions');
    expect(settings.providers[0]!.embeddingApiKey).toBe('embed-key');
  });
});
