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
    aiLogger.provider.init(config.id, config.model);
  }

  getModel(_params?: InferenceParams): LanguageModel {
    return this.client(this.config.model);
  }

  getEmbeddingModel(): EmbeddingModel {
    const embedModel = this.config.embeddingModel || 'gemini-embedding-001';
    return this.client.textEmbeddingModel(embedModel);
  }

  async isAvailable(): Promise<boolean> {
    return !!this.config.apiKey;
  }

  async healthCheck(): Promise<boolean> {
    if (!this.config.apiKey) return false;
    try {
      const baseUrl =
        this.config.baseUrl || 'https://generativelanguage.googleapis.com/v1beta';
      const response = await fetch(
        `${baseUrl}/models/${this.config.model}?key=${this.config.apiKey}`,
        { signal: AbortSignal.timeout(AI_TIMEOUTS.HEALTH_CHECK) },
      );
      return response.ok;
    } catch (e) {
      aiLogger.provider.error(this.id, (e as Error).message);
      return false;
    }
  }
}
