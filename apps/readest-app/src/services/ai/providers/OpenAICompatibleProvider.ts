import { createOpenAI } from '@ai-sdk/openai';
import type { LanguageModel, EmbeddingModel } from 'ai';
import type { AIProvider, AISettings, AIProviderName, AIProviderApiStyle } from '../types';
import { aiLogger } from '../logger';
import { AI_TIMEOUTS } from '../utils/retry';

interface OpenAICompatibleConfig {
  id: AIProviderName;
  name: string;
  apiStyle: AIProviderApiStyle;
  baseUrl: string;
  model: string;
  embeddingBaseUrl: string;
  embeddingModel: string;
  apiKey?: string;
  embeddingApiKey?: string;
}

export class OpenAICompatibleProvider implements AIProvider {
  id: AIProviderName;
  name: string;
  requiresAuth = false;

  private chatClient: ReturnType<typeof createOpenAI>;
  private embeddingClient: ReturnType<typeof createOpenAI>;
  private config: OpenAICompatibleConfig;

  constructor(config: OpenAICompatibleConfig) {
    this.id = config.id;
    this.name = config.name;
    this.config = config;
    this.chatClient = createOpenAI({
      baseURL: `${config.baseUrl}/v1`,
      apiKey: config.apiKey || 'not-required',
    });
    this.embeddingClient = createOpenAI({
      baseURL: `${config.embeddingBaseUrl}/v1`,
      apiKey: config.embeddingApiKey || 'not-required',
    });
    aiLogger.provider.init(config.id, config.model);
  }

  getModel(): LanguageModel {
    if (this.config.apiStyle === 'chat-completions') {
      return this.chatClient.chat(this.config.model);
    }
    return this.chatClient.responses(this.config.model);
  }

  getEmbeddingModel(): EmbeddingModel {
    return this.embeddingClient.embedding(this.config.embeddingModel);
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

  static fromSettings(settings: AISettings): OpenAICompatibleProvider {
    return new OpenAICompatibleProvider({
      id: 'openai-compatible',
      name: 'OpenAI-Compatible',
      apiStyle: settings.openAICompatibleApiStyle || 'chat-completions',
      baseUrl: settings.openAICompatibleBaseUrl || 'http://127.0.0.1:8080',
      model: settings.openAICompatibleModel || '',
      embeddingBaseUrl:
        settings.openAICompatibleEmbeddingBaseUrl ||
        settings.openAICompatibleBaseUrl ||
        'http://127.0.0.1:8081',
      embeddingModel: settings.openAICompatibleEmbeddingModel || '',
      apiKey: settings.openAICompatibleApiKey,
      embeddingApiKey: settings.openAICompatibleEmbeddingApiKey,
    });
  }
}
