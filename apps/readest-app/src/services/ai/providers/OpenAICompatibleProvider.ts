import { createOpenAI } from '@ai-sdk/openai';
import type { LanguageModel, EmbeddingModel } from 'ai';
import type { AIProvider, ProviderConfig, AIProviderApiStyle, InferenceParams } from '../types';
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
    this.chatClient = createOpenAI({
      baseURL: `${config.baseUrl}/v1`,
      apiKey: config.apiKey || 'not-required',
    });
    const embeddingBaseUrl = config.embeddingBaseUrl || config.baseUrl;
    this.embeddingClient = createOpenAI({
      baseURL: `${embeddingBaseUrl}/v1`,
      apiKey: config.embeddingApiKey || config.apiKey || 'not-required',
    });
    aiLogger.provider.init(config.id, config.model);
  }

  getModel(_params?: InferenceParams): LanguageModel {
    const apiStyle: AIProviderApiStyle = this.config.apiStyle || 'chat-completions';
    if (apiStyle === 'chat-completions') {
      return this.chatClient.chat(this.config.model);
    }
    return this.chatClient.responses(this.config.model);
  }

  getEmbeddingModel(): EmbeddingModel {
    return this.embeddingClient.embedding(this.config.embeddingModel || '');
  }

  async isAvailable(): Promise<boolean> {
    try {
      const controller = new AbortController();
      const timeout = setTimeout(() => controller.abort(), AI_TIMEOUTS.OLLAMA_CONNECT);
      const response = await fetch(`${this.config.baseUrl}/v1/models`, {
        signal: controller.signal,
        headers: this.config.apiKey ? { Authorization: `Bearer ${this.config.apiKey}` } : {},
      });
      clearTimeout(timeout);
      return response.ok;
    } catch {
      return false;
    }
  }

  async healthCheck(): Promise<boolean> {
    try {
      const controller = new AbortController();
      const timeout = setTimeout(() => controller.abort(), AI_TIMEOUTS.HEALTH_CHECK);
      const response = await fetch(`${this.config.baseUrl}/v1/models`, {
        signal: controller.signal,
        headers: this.config.apiKey ? { Authorization: `Bearer ${this.config.apiKey}` } : {},
      });
      clearTimeout(timeout);
      if (!response.ok) return false;
      const data = (await response.json()) as { data?: { id: string }[] };
      const models = data.data ?? [];
      return models.some((m) => m.id === this.config.model);
    } catch (e) {
      aiLogger.provider.error(this.config.id, (e as Error).message);
      return false;
    }
  }
}
