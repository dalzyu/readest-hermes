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
    aiLogger.provider.init(config.id, config.model || GATEWAY_MODELS.GEMINI_FLASH_LITE);
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
      // Leave auth header unset; the request will fail if the user is not authenticated.
    }

    return headers;
  }

  getModel(_params?: InferenceParams): LanguageModel {
    const modelId = this.config.model || GATEWAY_MODELS.GEMINI_FLASH_LITE;
    return this.gateway(modelId);
  }

  getEmbeddingModel(): EmbeddingModel {
    const embedModel = resolveEmbeddingModelId(this.config) || 'openai/text-embedding-3-small';

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

  async healthCheck(options?: { requireEmbedding?: boolean }): Promise<boolean> {
    if (!this.config.apiKey) return false;

    try {
      const modelId = this.config.model || GATEWAY_MODELS.GEMINI_FLASH_LITE;
      const headers = await this.getRequestHeaders();

      const response = await fetch('/api/ai/chat', {
        method: 'POST',
        headers,
        body: JSON.stringify({
          messages: [{ role: 'user', content: 'hi' }],
          apiKey: this.config.apiKey,
          model: modelId,
        }),
        signal: AbortSignal.timeout(AI_TIMEOUTS.HEALTH_CHECK),
      });

      if (!response.ok) return false;

      if (!options?.requireEmbedding) return true;

      const embeddingModel = resolveEmbeddingModelId(this.config);
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
