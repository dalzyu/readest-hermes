import { createAnthropic } from '@ai-sdk/anthropic';
import type { LanguageModel, EmbeddingModel } from 'ai';
import type { AIProvider, ProviderConfig, InferenceParams } from '../types';
import { aiLogger } from '../logger';
import { AI_TIMEOUTS } from '../utils/retry';

export class AnthropicProvider implements AIProvider {
  id: string;
  name: string;
  providerType = 'anthropic' as const;
  requiresAuth = true;

  private client: ReturnType<typeof createAnthropic>;
  private config: ProviderConfig;

  constructor(config: ProviderConfig) {
    this.id = config.id;
    this.name = config.name;
    this.config = config;
    if (!config.apiKey) {
      throw new Error('API key required for Anthropic');
    }
    this.client = createAnthropic({
      apiKey: config.apiKey,
      ...(config.baseUrl ? { baseURL: config.baseUrl } : {}),
    });
    aiLogger.provider.init(config.id, config.model);
  }

  getModel(_params?: InferenceParams): LanguageModel {
    return this.client(this.config.model);
  }

  getEmbeddingModel(): EmbeddingModel {
    throw new Error(
      'Anthropic does not support embeddings. Configure a separate embedding provider.',
    );
  }

  async isAvailable(): Promise<boolean> {
    return !!this.config.apiKey;
  }

  async healthCheck(options?: { requireEmbedding?: boolean }): Promise<boolean> {
    if (!this.config.apiKey) return false;
    if (options?.requireEmbedding) return false;
    try {
      const baseUrl = this.config.baseUrl || 'https://api.anthropic.com';
      const response = await fetch(`${baseUrl}/v1/messages`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'x-api-key': this.config.apiKey,
          'anthropic-version': '2023-06-01',
        },
        body: JSON.stringify({
          model: this.config.model,
          max_tokens: 1,
          messages: [{ role: 'user', content: 'hi' }],
        }),
        signal: AbortSignal.timeout(AI_TIMEOUTS.HEALTH_CHECK),
      });
      return response.ok;
    } catch (e) {
      aiLogger.provider.error(this.id, (e as Error).message);
      return false;
    }
  }
}
