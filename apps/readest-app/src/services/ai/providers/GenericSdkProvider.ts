import { createDeepSeek } from '@ai-sdk/deepseek';
import { createMistral } from '@ai-sdk/mistral';
import { createGroq } from '@ai-sdk/groq';
import { createOpenAICompatible } from '@ai-sdk/openai-compatible';
import type { LanguageModel, EmbeddingModel } from 'ai';
import type { AIProvider, ProviderConfig, AIProviderType, InferenceParams } from '../types';
import { providerTypeSupportsEmbeddings } from '../constants';
import { isGenericSdkProviderType } from '../capabilities';
import type { GenericSdkProviderType } from '../capabilities';
import { aiLogger } from '../logger';
import { AI_TIMEOUTS } from '../utils/retry';

type SdkClient = {
  (modelId: string): LanguageModel;
  textEmbeddingModel?: (modelId: string) => EmbeddingModel;
  embeddingModel?: (modelId: string) => EmbeddingModel;
};

type SdkFactory = (opts: { apiKey: string; baseURL?: string }) => SdkClient;

function createOpenAICompatibleFactory(providerName: string, defaultBaseUrl: string): SdkFactory {
  return ({ apiKey, baseURL }) =>
    createOpenAICompatible({
      apiKey,
      baseURL: baseURL || defaultBaseUrl,
      name: providerName,
    }) as unknown as SdkClient;
}

const SDK_FACTORIES: Record<GenericSdkProviderType, SdkFactory> = {
  deepseek: createDeepSeek as unknown as SdkFactory,
  mistral: createMistral as unknown as SdkFactory,
  groq: createGroq as unknown as SdkFactory,
  xai: createOpenAICompatibleFactory('xAI', 'https://api.x.ai/v1'),
  cohere: createOpenAICompatibleFactory('Cohere', 'https://api.cohere.ai/compatibility/v1'),
  fireworks: createOpenAICompatibleFactory('Fireworks', 'https://api.fireworks.ai/inference/v1'),
  togetherai: createOpenAICompatibleFactory('Together AI', 'https://api.together.xyz/v1'),
};

const V1_MODEL_ENDPOINT_PROVIDER_TYPES = new Set<AIProviderType>(['deepseek', 'mistral', 'groq']);

export class GenericSdkProvider implements AIProvider {
  id: string;
  name: string;
  providerType: AIProviderType;
  requiresAuth = true;

  private client: SdkClient;
  private config: ProviderConfig;

  constructor(config: ProviderConfig) {
    if (!isGenericSdkProviderType(config.providerType)) {
      throw new Error(`No SDK factory for provider type: ${config.providerType}`);
    }
    const factory = SDK_FACTORIES[config.providerType];
    if (!config.apiKey) {
      throw new Error(`API key required for ${config.providerType}`);
    }
    this.id = config.id;
    this.name = config.name;
    this.providerType = config.providerType;
    this.config = config;
    this.client = factory({
      apiKey: config.apiKey,
      ...(config.baseUrl ? { baseURL: config.baseUrl } : {}),
    });
    aiLogger.provider.init(config.id, config.models[0]?.id || '(unset)');
  }

  getModel(modelId: string, _params?: InferenceParams): LanguageModel {
    return this.client(modelId);
  }

  getEmbeddingModel(modelId: string): EmbeddingModel {
    const embeddingFactory = this.client.embeddingModel ?? this.client.textEmbeddingModel;
    if (!providerTypeSupportsEmbeddings(this.providerType) || !embeddingFactory) {
      throw new Error(
        `${this.providerType} does not support embeddings. Configure a separate embedding provider.`,
      );
    }
    return embeddingFactory(modelId);
  }

  async isAvailable(): Promise<boolean> {
    return !!this.config.apiKey;
  }

  async healthCheck(options?: {
    requireEmbedding?: boolean;
    modelId?: string;
    embeddingModelId?: string;
  }): Promise<boolean> {
    if (!this.config.apiKey || !options?.modelId) return false;
    try {
      const baseUrl = this.getHealthCheckBaseUrl();
      const response = await fetch(`${baseUrl}${this.getModelsPath()}`, {
        headers: { Authorization: `Bearer ${this.config.apiKey}` },
        signal: AbortSignal.timeout(AI_TIMEOUTS.HEALTH_CHECK),
      });
      if (!response.ok) return false;
      const data = (await response.json()) as { data?: Array<{ id: string }> };
      const models = (data.data ?? []).map((model) => model.id);
      if (!models.includes(options.modelId)) return false;
      if (!options?.requireEmbedding) return true;
      if (!providerTypeSupportsEmbeddings(this.providerType) || !options.embeddingModelId)
        return false;
      return models.includes(options.embeddingModelId);
    } catch (e) {
      aiLogger.provider.error(this.id, (e as Error).message);
      return false;
    }
  }

  private getHealthCheckBaseUrl(): string {
    const baseUrl = (this.config.baseUrl || this.getDefaultBaseUrl()).trim().replace(/\/+$/, '');
    return this.getModelsPath().startsWith('/v1/') ? baseUrl.replace(/\/v1$/, '') : baseUrl;
  }

  private getModelsPath(): string {
    return V1_MODEL_ENDPOINT_PROVIDER_TYPES.has(this.providerType) ? '/v1/models' : '/models';
  }

  private getDefaultBaseUrl(): string {
    switch (this.providerType) {
      case 'deepseek':
        return 'https://api.deepseek.com';
      case 'mistral':
        return 'https://api.mistral.ai';
      case 'groq':
        return 'https://api.groq.com/openai';
      case 'xai':
        return 'https://api.x.ai/v1';
      case 'cohere':
        return 'https://api.cohere.ai/compatibility/v1';
      case 'fireworks':
        return 'https://api.fireworks.ai/inference/v1';
      case 'togetherai':
        return 'https://api.together.xyz/v1';
      default:
        return '';
    }
  }

  static supports(providerType: AIProviderType): providerType is GenericSdkProviderType {
    return isGenericSdkProviderType(providerType);
  }
}
