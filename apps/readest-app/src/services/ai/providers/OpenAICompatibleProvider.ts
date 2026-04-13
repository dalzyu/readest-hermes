import { createOpenAI } from '@ai-sdk/openai';
import type { LanguageModel, EmbeddingModel } from 'ai';
import type { AIProvider, ProviderConfig, AIProviderApiStyle, InferenceParams } from '../types';
import { resolveEmbeddingModelId } from '../constants';
import { aiLogger } from '../logger';
import { AI_TIMEOUTS } from '../utils/retry';

export class OpenAICompatibleProvider implements AIProvider {
  id: string;
  name: string;
  providerType = 'openai-compatible' as const;
  requiresAuth = false;

  private chatClient: ReturnType<typeof createOpenAI>;
  private embeddingClient: ReturnType<typeof createOpenAI>;
  private config: ProviderConfig;

  constructor(config: ProviderConfig) {
    this.id = config.id;
    this.name = config.name;
    this.config = config;
    const chatBaseUrl = this.getChatBaseUrl();
    this.chatClient = createOpenAI({
      baseURL: chatBaseUrl,
      apiKey: config.apiKey || 'not-required',
    });
    const embeddingBaseUrl = this.getEmbeddingBaseUrl();
    this.embeddingClient = createOpenAI({
      baseURL: embeddingBaseUrl,
      apiKey: config.embeddingApiKey || config.apiKey || 'not-required',
    });
    aiLogger.provider.init(config.id, config.model);
  }

  private normalizeBaseUrl(baseUrl?: string): string {
    return (baseUrl || '').trim().replace(/\/+$/, '');
  }

  private getProviderBaseUrl(): string {
    return this.normalizeBaseUrl(
      this.config.baseUrl ||
        (this.config.providerType === 'openai' ? 'https://api.openai.com' : ''),
    );
  }

  private getChatBaseUrl(): string {
    return `${this.getProviderBaseUrl()}/v1`;
  }

  private getEmbeddingBaseUrl(): string {
    return `${this.normalizeBaseUrl(this.config.embeddingBaseUrl || this.getProviderBaseUrl())}/v1`;
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

  getModel(_params?: InferenceParams): LanguageModel {
    const apiStyle: AIProviderApiStyle = this.config.apiStyle || 'chat-completions';
    if (apiStyle === 'chat-completions') {
      return this.chatClient.chat(this.config.model);
    }
    return this.chatClient.responses(this.config.model);
  }

  getEmbeddingModel(): EmbeddingModel {
    const embeddingModel = resolveEmbeddingModelId(this.config);
    if (!embeddingModel) {
      throw new Error('Configure an embedding model for this provider.');
    }
    return this.embeddingClient.embedding(embeddingModel);
  }

  async isAvailable(): Promise<boolean> {
    try {
      const controller = new AbortController();
      const timeout = setTimeout(() => controller.abort(), AI_TIMEOUTS.OLLAMA_CONNECT);
      const response = await fetch(`${this.getChatBaseUrl()}/models`, {
        signal: controller.signal,
        headers: this.getAuthHeaders(this.config.apiKey),
      });
      clearTimeout(timeout);
      return response.ok;
    } catch {
      return false;
    }
  }

  async healthCheck(options?: { requireEmbedding?: boolean }): Promise<boolean> {
    try {
      const chatModels = await this.fetchModelIds(this.getChatBaseUrl(), this.config.apiKey);
      if (!chatModels.includes(this.config.model)) return false;
      if (!options?.requireEmbedding) return true;

      const embeddingModel = resolveEmbeddingModelId(this.config);
      if (!embeddingModel) return false;

      const embeddingBaseUrl = this.getEmbeddingBaseUrl();
      const embeddingApiKey = this.config.embeddingApiKey || this.config.apiKey;
      const embeddingModels =
        embeddingBaseUrl === this.getChatBaseUrl() && embeddingApiKey === this.config.apiKey
          ? chatModels
          : await this.fetchModelIds(embeddingBaseUrl, embeddingApiKey);

      return embeddingModels.includes(embeddingModel);
    } catch (e) {
      aiLogger.provider.error(this.config.id, (e as Error).message);
      return false;
    }
  }
}
