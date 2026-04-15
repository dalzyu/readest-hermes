import { createOllama } from 'ai-sdk-ollama';
import type { LanguageModel, EmbeddingModel } from 'ai';
import type { AIProvider, ProviderConfig, InferenceParams } from '../types';
import { resolveEmbeddingModelId } from '../constants';
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

  private getBaseUrl(): string {
    return this.config.baseUrl || 'http://127.0.0.1:11434';
  }

  private normalizeModelName(name: string): string {
    return name.trim().replace(/:latest$/i, '');
  }

  private hasModel(models: Array<{ name: string }>, requestedName: string): boolean {
    if (!requestedName.trim()) return false;
    const normalizedRequested = this.normalizeModelName(requestedName);
    return models.some((model) => this.normalizeModelName(model.name) === normalizedRequested);
  }

  getModel(_params?: InferenceParams): LanguageModel {
    return this.ollama(this.config.model || 'llama3.2');
  }

  getEmbeddingModel(): EmbeddingModel {
    return this.ollama.embeddingModel(resolveEmbeddingModelId(this.config) || 'nomic-embed-text');
  }

  async isAvailable(): Promise<boolean> {
    try {
      const controller = new AbortController();
      const timeout = setTimeout(() => controller.abort(), AI_TIMEOUTS.OLLAMA_CONNECT);
      const response = await fetch(`${this.getBaseUrl()}/api/tags`, {
        signal: controller.signal,
      });
      clearTimeout(timeout);
      return response.ok;
    } catch {
      return false;
    }
  }

  async healthCheck(options?: { requireEmbedding?: boolean }): Promise<boolean> {
    try {
      const controller = new AbortController();
      const timeout = setTimeout(() => controller.abort(), AI_TIMEOUTS.HEALTH_CHECK);
      const response = await fetch(`${this.getBaseUrl()}/api/tags`, {
        signal: controller.signal,
      });
      clearTimeout(timeout);
      if (!response.ok) return false;
      const data = (await response.json()) as { models?: Array<{ name: string }> };
      const models = data.models ?? [];
      const hasChatModel = this.hasModel(models, this.config.model || 'llama3.2');
      if (!hasChatModel) {
        const available = models.map((m) => m.name).join(', ');
        aiLogger.provider.error(
          this.id,
          `Model "${this.config.model}" not found. Available: ${available || '(none)'}`,
        );
        return false;
      }
      if (!options?.requireEmbedding) return true;

      const embeddingModelName = resolveEmbeddingModelId(this.config);
      return !!embeddingModelName && this.hasModel(models, embeddingModelName);
    } catch (e) {
      aiLogger.provider.error(this.id, (e as Error).message);
      return false;
    }
  }
}
