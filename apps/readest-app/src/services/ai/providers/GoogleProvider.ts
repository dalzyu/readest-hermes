import { createGoogleGenerativeAI } from '@ai-sdk/google';
import type { LanguageModel, EmbeddingModel } from 'ai';
import type { AIProvider, ProviderConfig, InferenceParams } from '../types';
import { resolveEmbeddingModelId } from '../constants';
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
    aiLogger.provider.init(config.id, config.model);
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

  getModel(_params?: InferenceParams): LanguageModel {
    return this.client(this.config.model);
  }

  getEmbeddingModel(): EmbeddingModel {
    const embedModel = resolveEmbeddingModelId(this.config) || 'gemini-embedding-001';
    return this.client.textEmbeddingModel(embedModel);
  }

  async isAvailable(): Promise<boolean> {
    return !!this.config.apiKey;
  }

  async healthCheck(options?: { requireEmbedding?: boolean }): Promise<boolean> {
    if (!this.config.apiKey) return false;
    try {
      if (!(await this.checkModel(this.config.model))) return false;
      if (!options?.requireEmbedding) return true;

      const embeddingModel = resolveEmbeddingModelId(this.config);
      return !!embeddingModel && (await this.checkModel(embeddingModel));
    } catch (e) {
      aiLogger.provider.error(this.id, (e as Error).message);
      return false;
    }
  }
}
