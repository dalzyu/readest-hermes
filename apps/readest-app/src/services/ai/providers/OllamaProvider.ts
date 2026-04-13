import { createOllama } from 'ai-sdk-ollama';
import type { LanguageModel, EmbeddingModel } from 'ai';
import type { AIProvider, ProviderConfig, InferenceParams } from '../types';
import { aiLogger } from '../logger';
import { AI_TIMEOUTS } from '../utils/retry';

export class OllamaProvider implements AIProvider {
  id: string;
  name: string;
  providerType = 'ollama' as const;
  requiresAuth = false;

  private ollama;
  private config: ProviderConfig;

  constructor(config: ProviderConfig) {
    this.id = config.id;
    this.name = config.name;
    this.config = config;
    this.ollama = createOllama({
      baseURL: config.baseUrl || 'http://127.0.0.1:11434',
    });
    aiLogger.provider.init(config.id, config.model || 'llama3.2');
  }

  getModel(_params?: InferenceParams): LanguageModel {
    return this.ollama(this.config.model || 'llama3.2');
  }

  getEmbeddingModel(): EmbeddingModel {
    return this.ollama.embeddingModel(this.config.embeddingModel || 'nomic-embed-text');
  }

  async isAvailable(): Promise<boolean> {
    try {
      const controller = new AbortController();
      const timeout = setTimeout(() => controller.abort(), AI_TIMEOUTS.OLLAMA_CONNECT);
      const response = await fetch(`${this.config.baseUrl}/api/tags`, {
        signal: controller.signal,
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
      const response = await fetch(`${this.config.baseUrl}/api/tags`, {
        signal: controller.signal,
      });
      clearTimeout(timeout);
      if (!response.ok) return false;
      const data = await response.json();
      const modelName = this.config.model?.split(':')[0] ?? '';
      const embeddingModelName = this.config.embeddingModel?.split(':')[0] ?? '';
      return (
        data.models?.some((m: { name: string }) => m.name.includes(modelName)) &&
        data.models?.some((m: { name: string }) => m.name.includes(embeddingModelName))
      );
    } catch (e) {
      aiLogger.provider.error(this.id, (e as Error).message);
      return false;
    }
  }
}
