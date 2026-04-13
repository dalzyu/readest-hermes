import type { AISettings, ProviderConfig } from './types';

// cheapest popular models as of 2025
export const GATEWAY_MODELS = {
  GEMINI_FLASH_LITE: 'google/gemini-2.5-flash-lite',
  GPT_5_NANO: 'openai/gpt-5-nano',
  LLAMA_4_SCOUT: 'meta/llama-4-scout',
  GROK_4_1_FAST: 'xai/grok-4.1-fast-reasoning',
  DEEPSEEK_V3_2: 'deepseek/deepseek-v3.2',
  QWEN_3_235B: 'alibaba/qwen-3-235b',
} as const;

export const MODEL_PRICING: Record<string, { input: string; output: string }> = {
  [GATEWAY_MODELS.GEMINI_FLASH_LITE]: { input: '0.1', output: '0.4' },
  [GATEWAY_MODELS.GPT_5_NANO]: { input: '0.05', output: '0.4' },
  [GATEWAY_MODELS.LLAMA_4_SCOUT]: { input: '0.08', output: '0.3' },
  [GATEWAY_MODELS.GROK_4_1_FAST]: { input: '0.2', output: '0.5' },
  [GATEWAY_MODELS.DEEPSEEK_V3_2]: { input: '0.27', output: '0.4' },
  [GATEWAY_MODELS.QWEN_3_235B]: { input: '0.07', output: '0.46' },
};

/** Built-in provider preset for Ollama. */
export const DEFAULT_OLLAMA_CONFIG: ProviderConfig = {
  id: 'ollama-default',
  name: 'Ollama (Local)',
  providerType: 'ollama',
  baseUrl: 'http://127.0.0.1:11434',
  model: 'llama3.2',
  embeddingModel: 'nomic-embed-text',
};

/** Built-in provider preset for OpenAI-compatible local server. */
export const DEFAULT_OPENAI_COMPATIBLE_CONFIG: ProviderConfig = {
  id: 'openai-compat-default',
  name: 'OpenAI-Compatible (Local)',
  providerType: 'openai-compatible',
  baseUrl: 'http://127.0.0.1:8080',
  model: '',
  apiStyle: 'chat-completions',
  embeddingBaseUrl: 'http://127.0.0.1:8081',
  embeddingModel: '',
};

/** Built-in provider preset for AI Gateway (Cloud). */
export const DEFAULT_AI_GATEWAY_CONFIG: ProviderConfig = {
  id: 'ai-gateway-default',
  name: 'AI Gateway (Cloud)',
  providerType: 'ai-gateway',
  baseUrl: '',
  model: GATEWAY_MODELS.GEMINI_FLASH_LITE,
  embeddingModel: 'openai/text-embedding-3-small',
};

export const DEFAULT_AI_SETTINGS: AISettings = {
  enabled: false,
  providers: [DEFAULT_OLLAMA_CONFIG],
  activeProviderId: 'ollama-default',
  modelAssignments: {},

  spoilerProtection: true,
  maxContextChunks: 10,
  indexingMode: 'on-demand',
};
