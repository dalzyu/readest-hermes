import { createGateway } from 'ai';
import type { LanguageModel, EmbeddingModel } from 'ai';
import type { AIProvider, ProviderConfig, InferenceParams } from '../types';
import { aiLogger } from '../logger';
import { GATEWAY_MODELS } from '../constants';
import { AI_TIMEOUTS } from '../utils/retry';
import { createProxiedEmbeddingModel } from './ProxiedGatewayEmbedding';

export class AIGatewayProvider implements AIProvider {
  id: string;
  name: string;
  providerType = 'ai-gateway' as const;
  requiresAuth = true;

  private config: ProviderConfig;
  private gateway: ReturnType<typeof createGateway>;

  constructor(config: ProviderConfig) {
    this.id = config.id;
    this.name = config.name;
    this.config = config;
    if (!config.apiKey) {
      throw new Error('AI Gateway API key required');
    }
    this.gateway = createGateway({ apiKey: config.apiKey });
    aiLogger.provider.init(config.id, config.model || GATEWAY_MODELS.GEMINI_FLASH_LITE);
  }

  getModel(_params?: InferenceParams): LanguageModel {
    const modelId = this.config.model || GATEWAY_MODELS.GEMINI_FLASH_LITE;
    return this.gateway(modelId);
  }

  getEmbeddingModel(): EmbeddingModel {
    const embedModel = this.config.embeddingModel || 'openai/text-embedding-3-small';

    if (typeof window !== 'undefined') {
      return createProxiedEmbeddingModel({
        apiKey: this.config.apiKey!,
        model: embedModel,
      });
    }

    return this.gateway.embeddingModel(embedModel);
  }

  async isAvailable(): Promise<boolean> {
    return !!this.config.apiKey;
  }

  async healthCheck(): Promise<boolean> {
    if (!this.config.apiKey) return false;

    try {
      const modelId = this.config.model || GATEWAY_MODELS.GEMINI_FLASH_LITE;
      aiLogger.provider.init(this.id, `healthCheck starting with model: ${modelId}`);

      const response = await fetch('/api/ai/chat', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          messages: [{ role: 'user', content: 'hi' }],
          apiKey: this.config.apiKey,
          model: modelId,
        }),
        signal: AbortSignal.timeout(AI_TIMEOUTS.HEALTH_CHECK),
      });

      if (!response.ok) {
        const error = await response.json().catch(() => ({ error: 'Unknown error' }));
        throw new Error(error.error || `Health check failed: ${response.status}`);
      }

      aiLogger.provider.init(this.id, 'healthCheck success');
      return true;
    } catch (e) {
      const error = e as Error;
      aiLogger.provider.error(this.id, `healthCheck failed: ${error.message}`);
      return false;
    }
  }
}
