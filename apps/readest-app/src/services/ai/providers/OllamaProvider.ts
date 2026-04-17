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
    aiLogger.provider.init(config.id, config.models[0]?.id || '(unset)');
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

  getModel(modelId: string, _params?: InferenceParams): LanguageModel {
    return this.ollama(modelId);
  }

  getEmbeddingModel(modelId: string): EmbeddingModel {
    return this.ollama.embeddingModel(modelId);
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

  async healthCheck(options?: {
    requireEmbedding?: boolean;
    modelId?: string;
    embeddingModelId?: string;
  }): Promise<boolean> {
    if (!options?.modelId) return false;
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
      const hasChatModel = this.hasModel(models, options.modelId);
      if (!hasChatModel) {
        const available = models.map((m) => m.name).join(', ');
        aiLogger.provider.error(
          this.id,
          `Model "${options.modelId}" not found. Available: ${available || '(none)'}`,
        );
        return false;
      }
      if (!options?.requireEmbedding) return true;
      if (!options.embeddingModelId) return false;
      return this.hasModel(models, options.embeddingModelId);
    } catch (e) {
      aiLogger.provider.error(this.id, (e as Error).message);
      return false;
    }
  }
}
