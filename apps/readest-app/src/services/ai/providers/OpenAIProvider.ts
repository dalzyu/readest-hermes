import { createOpenAI } from '@ai-sdk/openai';
import type { LanguageModel, EmbeddingModel } from 'ai';
import type { AIProvider, ProviderConfig, AIProviderApiStandard, InferenceParams } from '../types';
import { aiLogger } from '../logger';
import { AI_TIMEOUTS } from '../utils/retry';

export class OpenAIProvider implements AIProvider {
  id: string;
  name: string;
  providerType = 'openai' as const;
  requiresAuth = false;

  private client: ReturnType<typeof createOpenAI>;
  private config: ProviderConfig;

  constructor(config: ProviderConfig) {
    this.id = config.id;
    this.name = config.name;
    this.config = config;
    this.client = createOpenAI({
      baseURL: this.getApiBaseUrl(),
      apiKey: config.apiKey || 'not-required',
    });

    aiLogger.provider.init(config.id, config.models[0]?.id || '(unset)');
  }

  private normalizeBaseUrl(baseUrl?: string): string {
    return (baseUrl || '').trim().replace(/\/+$/, '').replace(/\/v1$/, '');
  }

  private getApiBaseUrl(): string {
    const base = this.normalizeBaseUrl(this.config.baseUrl || 'https://api.openai.com');
    return `${base}/v1`;
  }

  private getAuthHeaders(apiKey?: string): HeadersInit {
    return apiKey ? { Authorization: `Bearer ${apiKey}` } : {};
  }

  private async fetchModelIds(baseUrl: string, apiKey?: string): Promise<string[]> {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), AI_TIMEOUTS.HEALTH_CHECK);
    try {
      const response = await fetch(`${baseUrl}/models`, {
        signal: controller.signal,
        headers: this.getAuthHeaders(apiKey),
      });
      if (!response.ok) return [];
      const data = (await response.json()) as { data?: Array<{ id: string }> };
      return (data.data ?? []).map((model) => model.id);
    } finally {
      clearTimeout(timeout);
    }
  }

  getModel(modelId: string, _params?: InferenceParams): LanguageModel {
    const apiStandard: AIProviderApiStandard = this.config.apiStandard || 'chat-completions';
    if (apiStandard === 'chat-completions') {
      return this.client.chat(modelId);
    }
    return this.client.responses(modelId);
  }

  getEmbeddingModel(modelId: string): EmbeddingModel {
    return this.client.embedding(modelId);
  }

  async isAvailable(): Promise<boolean> {
    try {
      const controller = new AbortController();
      const timeout = setTimeout(() => controller.abort(), AI_TIMEOUTS.OLLAMA_CONNECT);
      const response = await fetch(`${this.getApiBaseUrl()}/models`, {
        signal: controller.signal,
        headers: this.getAuthHeaders(this.config.apiKey),
      });
      clearTimeout(timeout);
      return response.ok;
    } catch {
      return false;
    }
  }

  async healthCheck(options?: {
    requireEmbedding?: boolean;
    modelId?: string;
    embeddingModelId?: string;
  }): Promise<boolean> {
    try {
      const models = await this.fetchModelIds(this.getApiBaseUrl(), this.config.apiKey);
      const chatModelId = options?.modelId;
      if (chatModelId && !models.includes(chatModelId)) return false;
      if (!options?.requireEmbedding) return true;
      const embeddingModelId = options?.embeddingModelId;
      if (!embeddingModelId) return false;
      return models.includes(embeddingModelId);
    } catch (e) {
      aiLogger.provider.error(this.config.id, (e as Error).message);
      return false;
    }
  }
}
