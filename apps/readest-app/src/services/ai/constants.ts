import type {
  AISettings,
  AIProfile,
  AITaskType,
  AIProviderType,
  ModelEntry,
  ProviderConfig,
} from './types';

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
  models: [
    { id: 'llama3.2', kind: 'chat' },
    { id: 'nomic-embed-text', kind: 'embedding' },
  ],
};

/** Built-in provider preset for OpenAI-compatible servers and OpenAI API. */
export const DEFAULT_OPENAI_CONFIG: ProviderConfig = {
  id: 'openai-default',
  name: 'OpenAI',
  providerType: 'openai',
  baseUrl: 'https://api.openai.com',
  models: [
    { id: 'gpt-4o-mini', kind: 'chat' },
    { id: 'text-embedding-3-small', kind: 'embedding' },
  ],
  apiStandard: 'chat-completions',
};

/** Built-in provider preset for AI Gateway. */
export const DEFAULT_AI_GATEWAY_CONFIG: ProviderConfig = {
  id: 'ai-gateway-default',
  name: 'AI Gateway',
  providerType: 'ai-gateway',
  baseUrl: '',
  models: [
    { id: GATEWAY_MODELS.GEMINI_FLASH_LITE, kind: 'chat' },
    { id: 'openai/text-embedding-3-small', kind: 'embedding' },
  ],
};

export const EMBEDDING_CAPABLE_PROVIDER_TYPES: ReadonlySet<AIProviderType> = new Set([
  'ollama',
  'openai',
  'google',
  'mistral',
  'ai-gateway',
]);

export function providerTypeSupportsEmbeddings(providerType: AIProviderType): boolean {
  return EMBEDDING_CAPABLE_PROVIDER_TYPES.has(providerType);
}

function findModelByKind(
  models: ModelEntry[] | undefined,
  kind: ModelEntry['kind'],
): string | undefined {
  return models?.find((model) => model.kind === kind)?.id?.trim() || undefined;
}

export function resolveChatModelId(config: Pick<ProviderConfig, 'models'>): string | undefined {
  return findModelByKind(config.models, 'chat');
}

export function resolveEmbeddingModelId(
  config: Pick<ProviderConfig, 'models'>,
): string | undefined {
  return findModelByKind(config.models, 'embedding');
}

export function providerConfigCanServeEmbeddings(
  config: Pick<ProviderConfig, 'providerType' | 'models'>,
): boolean {
  return providerTypeSupportsEmbeddings(config.providerType) && !!resolveEmbeddingModelId(config);
}

export const DEFAULT_AI_PROFILE: AIProfile = {
  id: 'default',
  name: 'Default',
  modelAssignments: {},
  inferenceParamsByTask: {},
};

export function getDefaultTaskSelection(providerId?: string, modelId?: string) {
  if (!providerId || !modelId) return undefined;
  return { providerId, modelId };
}

export const DEFAULT_AI_SETTINGS: AISettings = {
  enabled: false,
  providers: [],
  profiles: [DEFAULT_AI_PROFILE],
  activeProfileId: DEFAULT_AI_PROFILE.id,
  developerMode: false,

  spoilerProtection: true,
  maxContextChunks: 10,
  indexingMode: 'on-demand',
};

export function findProfileOrDefault(settings: AISettings): AIProfile {
  return (
    settings.profiles.find((profile) => profile.id === settings.activeProfileId) ??
    settings.profiles[0]!
  );
}

export function getAssignmentForTask(settings: AISettings, task: AITaskType) {
  return findProfileOrDefault(settings).modelAssignments[task];
}
