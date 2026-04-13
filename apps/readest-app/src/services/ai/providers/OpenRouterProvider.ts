import { createOpenRouter } from '@openrouter/ai-sdk-provider';
import type { LanguageModel, EmbeddingModel } from 'ai';
import type { AIProvider, ProviderConfig, InferenceParams } from '../types';
import { aiLogger } from '../logger';
import { AI_TIMEOUTS } from '../utils/retry';

export class OpenRouterProvider implements AIProvider {
  id: string;
  name: string;
  providerType = 'openrouter' as const;
  requiresAuth = true;

  private client: ReturnType<typeof createOpenRouter>;
  private config: ProviderConfig;

  constructor(config: ProviderConfig) {
    this.id = config.id;
    this.name = config.name;
    this.config = config;
    if (!config.apiKey) {
      throw new Error('API key required for OpenRouter');
    }
    this.client = createOpenRouter({
      apiKey: config.apiKey,
    });
    aiLogger.provider.init(config.id, config.model);
  }

  getModel(_params?: InferenceParams): LanguageModel {
    return this.client.chat(this.config.model);
  }

  getEmbeddingModel(): EmbeddingModel {
    throw new Error(
      'OpenRouter does not support embeddings. Configure a separate embedding provider.',
    );
  }

  async isAvailable(): Promise<boolean> {
    return !!this.config.apiKey;
  }

  async healthCheck(options?: { requireEmbedding?: boolean }): Promise<boolean> {
    if (options?.requireEmbedding) return false;
    if (!this.config.apiKey) return false;
    try {
      const response = await fetch('https://openrouter.ai/api/v1/models', {
        headers: { Authorization: `Bearer ${this.config.apiKey}` },
        signal: AbortSignal.timeout(AI_TIMEOUTS.HEALTH_CHECK),
      });
      if (!response.ok) return false;
      const data = (await response.json()) as { data?: { id: string }[] };
      const models = data.data ?? [];
      return models.some((m) => m.id === this.config.model);
    } catch (e) {
      aiLogger.provider.error(this.id, (e as Error).message);
      return false;
    }
  }
}
