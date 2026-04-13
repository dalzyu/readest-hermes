import { createDeepSeek } from '@ai-sdk/deepseek';
import { createMistral } from '@ai-sdk/mistral';
import { createGroq } from '@ai-sdk/groq';
import type { LanguageModel, EmbeddingModel } from 'ai';
import type { AIProvider, ProviderConfig, AIProviderType, InferenceParams } from '../types';
import { aiLogger } from '../logger';
import { AI_TIMEOUTS } from '../utils/retry';

type SdkFactory = (opts: { apiKey: string; baseURL?: string }) => {
  (modelId: string): LanguageModel;
  textEmbeddingModel?: (modelId: string) => EmbeddingModel;
};

const SDK_FACTORIES: Partial<Record<AIProviderType, SdkFactory>> = {
  deepseek: createDeepSeek as unknown as SdkFactory,
  mistral: createMistral as unknown as SdkFactory,
  groq: createGroq as unknown as SdkFactory,
};

const EMBEDDING_CAPABLE: Set<AIProviderType> = new Set(['mistral']);

export class GenericSdkProvider implements AIProvider {
  id: string;
  name: string;
  providerType: AIProviderType;
  requiresAuth = true;

  private client: ReturnType<SdkFactory>;
  private config: ProviderConfig;

  constructor(config: ProviderConfig) {
    const factory = SDK_FACTORIES[config.providerType];
    if (!factory) {
      throw new Error(`No SDK factory for provider type: ${config.providerType}`);
    }
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
    aiLogger.provider.init(config.id, config.model);
  }

  getModel(_params?: InferenceParams): LanguageModel {
    return this.client(this.config.model);
  }

  getEmbeddingModel(): EmbeddingModel {
    if (!EMBEDDING_CAPABLE.has(this.providerType) || !this.client.textEmbeddingModel) {
      throw new Error(
        `${this.providerType} does not support embeddings. Configure a separate embedding provider.`,
      );
    }
    return this.client.textEmbeddingModel(this.config.embeddingModel || '');
  }

  async isAvailable(): Promise<boolean> {
    return !!this.config.apiKey;
  }

  async healthCheck(): Promise<boolean> {
    if (!this.config.apiKey) return false;
    try {
      // Most providers expose an OpenAI-compatible /v1/models endpoint
      const baseUrl = this.config.baseUrl || this.getDefaultBaseUrl();
      const response = await fetch(`${baseUrl}/v1/models`, {
        headers: { Authorization: `Bearer ${this.config.apiKey}` },
        signal: AbortSignal.timeout(AI_TIMEOUTS.HEALTH_CHECK),
      });
      return response.ok;
    } catch (e) {
      aiLogger.provider.error(this.id, (e as Error).message);
      return false;
    }
  }

  private getDefaultBaseUrl(): string {
    switch (this.providerType) {
      case 'deepseek':
        return 'https://api.deepseek.com';
      case 'mistral':
        return 'https://api.mistral.ai';
      case 'groq':
        return 'https://api.groq.com/openai';
      default:
        return '';
    }
  }

  static supports(providerType: AIProviderType): boolean {
    return providerType in SDK_FACTORIES;
  }
}
