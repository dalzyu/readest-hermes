import { createGoogleGenerativeAI } from '@ai-sdk/google';
import type { LanguageModel, EmbeddingModel } from 'ai';
import type { AIProvider, ProviderConfig, InferenceParams } from '../types';
import { aiLogger } from '../logger';
import { AI_TIMEOUTS } from '../utils/retry';

export class GoogleProvider implements AIProvider {
  id: string;
  name: string;
  providerType = 'google' as const;
  requiresAuth = true;

  private client: ReturnType<typeof createGoogleGenerativeAI>;
  private config: ProviderConfig;

  constructor(config: ProviderConfig) {
    this.id = config.id;
    this.name = config.name;
    this.config = config;
    if (!config.apiKey) {
      throw new Error('API key required for Google AI');
    }
    this.client = createGoogleGenerativeAI({
      apiKey: config.apiKey,
      ...(config.baseUrl ? { baseURL: config.baseUrl } : {}),
    });
    aiLogger.provider.init(config.id, config.models[0]?.id || '(unset)');
  }

  private getBaseUrl(): string {
    return this.config.baseUrl || 'https://generativelanguage.googleapis.com/v1beta';
  }

  private async checkModel(modelId: string): Promise<boolean> {
    const response = await fetch(
      `${this.getBaseUrl()}/models/${modelId}?key=${this.config.apiKey}`,
      {
        signal: AbortSignal.timeout(AI_TIMEOUTS.HEALTH_CHECK),
      },
    );
    return response.ok;
  }

  getModel(modelId: string, _params?: InferenceParams): LanguageModel {
    return this.client(modelId);
  }

  getEmbeddingModel(modelId: string): EmbeddingModel {
    return this.client.textEmbeddingModel(modelId);
  }

  async isAvailable(): Promise<boolean> {
    return !!this.config.apiKey;
  }

  async healthCheck(options?: {
    requireEmbedding?: boolean;
    modelId?: string;
    embeddingModelId?: string;
  }): Promise<boolean> {
    if (!this.config.apiKey) return false;
    if (!options?.modelId) return false;
    try {
      if (!(await this.checkModel(options.modelId))) return false;
      if (!options?.requireEmbedding) return true;
      if (!options.embeddingModelId) return false;
      return await this.checkModel(options.embeddingModelId);
    } catch (e) {
      aiLogger.provider.error(this.id, (e as Error).message);
      return false;
    }
  }
}
