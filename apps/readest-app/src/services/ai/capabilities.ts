import type { AIProviderType } from './types';

export const SUPPORTED_PROVIDER_TYPES = [
  'ollama',
  'openai',
  'anthropic',
  'google',
  'openrouter',
  'deepseek',
  'mistral',
  'groq',
  'xai',
  'cohere',
  'fireworks',
  'togetherai',
  'ai-gateway',
] as const satisfies readonly AIProviderType[];

export const SUPPORTED_PROVIDER_TYPES_SET: ReadonlySet<AIProviderType> = new Set(
  SUPPORTED_PROVIDER_TYPES,
);

export const GENERIC_SDK_PROVIDER_TYPES = [
  'deepseek',
  'mistral',
  'groq',
  'xai',
  'cohere',
  'fireworks',
  'togetherai',
] as const satisfies readonly AIProviderType[];

export type GenericSdkProviderType = (typeof GENERIC_SDK_PROVIDER_TYPES)[number];

export const GENERIC_SDK_PROVIDER_TYPES_SET: ReadonlySet<GenericSdkProviderType> = new Set(
  GENERIC_SDK_PROVIDER_TYPES,
);

export const AI_GATEWAY_EMBEDDING_MODEL_ALLOWLIST = [
  'openai/text-embedding-3-small',
  'openai/text-embedding-3-large',
  'google/text-embedding-004',
  'cohere/embed-multilingual-v3',
] as const;

export type AIGatewayEmbeddingModel = (typeof AI_GATEWAY_EMBEDDING_MODEL_ALLOWLIST)[number];

export const AI_GATEWAY_EMBEDDING_MODEL_ALLOWLIST_SET: ReadonlySet<AIGatewayEmbeddingModel> =
  new Set(AI_GATEWAY_EMBEDDING_MODEL_ALLOWLIST);

export function isSupportedProviderType(providerType: AIProviderType): boolean {
  return SUPPORTED_PROVIDER_TYPES_SET.has(providerType);
}

export function isGenericSdkProviderType(
  providerType: AIProviderType,
): providerType is GenericSdkProviderType {
  return GENERIC_SDK_PROVIDER_TYPES_SET.has(providerType as GenericSdkProviderType);
}

export function isAllowedAIGatewayEmbeddingModel(model: string): model is AIGatewayEmbeddingModel {
  return AI_GATEWAY_EMBEDDING_MODEL_ALLOWLIST_SET.has(model as AIGatewayEmbeddingModel);
}
