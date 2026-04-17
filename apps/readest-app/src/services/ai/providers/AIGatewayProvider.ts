import { createGateway } from 'ai';
import type { LanguageModel, EmbeddingModel } from 'ai';
import type { AIProvider, ProviderConfig, InferenceParams } from '../types';
import { resolveEmbeddingModelId } from '../constants';
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
    aiLogger.provider.init(config.id, config.models[0]?.id || GATEWAY_MODELS.GEMINI_FLASH_LITE);
  }

  private async getRequestHeaders(): Promise<Record<string, string>> {
    const headers: Record<string, string> = { 'Content-Type': 'application/json' };

    try {
      const { getAccessToken } = await import('@/utils/access');
      const token = await getAccessToken();
      if (token) {
        headers['Authorization'] = `Bearer ${token}`;
      }
    } catch (error) {
      aiLogger.provider.error(this.id, `getRequestHeaders: getAccessToken failed: ${error}`);
    }

    return headers;
  }

  getModel(modelId: string, _params?: InferenceParams): LanguageModel {
    return this.gateway(modelId || GATEWAY_MODELS.GEMINI_FLASH_LITE);
  }

  getEmbeddingModel(modelId: string): EmbeddingModel {
    if (typeof window !== 'undefined') {
      return createProxiedEmbeddingModel({
        apiKey: this.config.apiKey!,
        model: modelId,
      });
    }

    return this.gateway.embeddingModel(modelId);
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
      const headers = await this.getRequestHeaders();

      const response = await fetch('/api/ai/chat', {
        method: 'POST',
        headers,
        body: JSON.stringify({
          messages: [{ role: 'user', content: 'hi' }],
          apiKey: this.config.apiKey,
          model: options.modelId,
        }),
        signal: AbortSignal.timeout(AI_TIMEOUTS.HEALTH_CHECK),
      });

      if (!response.ok) return false;

      if (!options?.requireEmbedding) return true;

      const embeddingModel = options.embeddingModelId || resolveEmbeddingModelId(this.config);
      if (!embeddingModel) return false;

      const embeddingResponse = await fetch('/api/ai/embed', {
        method: 'POST',
        headers,
        body: JSON.stringify({
          texts: ['health check'],
          single: true,
          apiKey: this.config.apiKey,
          model: embeddingModel,
        }),
        signal: AbortSignal.timeout(AI_TIMEOUTS.HEALTH_CHECK),
      });

      return embeddingResponse.ok;
    } catch (e) {
      const error = e as Error;
      aiLogger.provider.error(this.id, `healthCheck failed: ${error.message}`);
      return false;
    }
  }
}
