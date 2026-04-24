import { OllamaProvider } from './OllamaProvider';
import { AIGatewayProvider } from './AIGatewayProvider';
import { OpenAIProvider } from './OpenAIProvider';
import { AnthropicProvider } from './AnthropicProvider';
import { GoogleProvider } from './GoogleProvider';
import { OpenRouterProvider } from './OpenRouterProvider';
import { GenericSdkProvider } from './GenericSdkProvider';
import type {
  AIProvider,
  AISettings,
  ProviderConfig,
  AITaskType,
  InferenceParams,
  ModelEntry,
  TaskModelSelection,
} from '../types';
import {
  providerConfigCanServeEmbeddings,
  providerTypeSupportsEmbeddings,
  findProfileOrDefault,
} from '../constants';
import { isSupportedProviderType } from '../capabilities';
import { TASK_INFERENCE_DEFAULTS } from '../types';

export {
  OllamaProvider,
  AIGatewayProvider,
  OpenAIProvider,
  AnthropicProvider,
  GoogleProvider,
  OpenRouterProvider,
  GenericSdkProvider,
};

// ---------------------------------------------------------------------------
// Provider instantiation from a single ProviderConfig
// ---------------------------------------------------------------------------

export function createProviderFromConfig(config: ProviderConfig): AIProvider {
  if (!isSupportedProviderType(config.providerType)) {
    throw new Error(`Unknown provider type: ${config.providerType}`);
  }

  switch (config.providerType) {
    case 'ollama':
      return new OllamaProvider(config);
    case 'ai-gateway':
      return new AIGatewayProvider(config);
    case 'openai':
      return new OpenAIProvider(config);
    case 'anthropic':
      return new AnthropicProvider(config);
    case 'google':
      return new GoogleProvider(config);
    case 'openrouter':
      return new OpenRouterProvider(config);
    default:
      if (GenericSdkProvider.supports(config.providerType)) {
        return new GenericSdkProvider(config);
      }
      throw new Error(`Unknown provider type: ${config.providerType}`);
  }
}

function getTaskModelKind(task: AITaskType): ModelEntry['kind'] {
  return task === 'embedding' ? 'embedding' : 'chat';
}

function findProviderModel(
  config: ProviderConfig,
  task: AITaskType,
  selectedModelId?: string,
): string | undefined {
  const kind = getTaskModelKind(task);
  const models = config.models ?? [];
  if (selectedModelId) {
    const selected = models.find((model) => model.id === selectedModelId && model.kind === kind);
    if (selected) return selected.id;
  }
  return models.find((model) => model.kind === kind)?.id;
}

function resolveTaskSelection(
  settings: AISettings,
  task: AITaskType,
): {
  config: ProviderConfig;
  modelId: string;
  selection?: TaskModelSelection;
} {
  const { providers } = settings;
  if (!providers.length) {
    throw new Error('No AI providers configured');
  }

  const profile = findProfileOrDefault(settings);
  const selection = profile.modelAssignments[task];

  if (selection?.providerId) {
    const assignedProvider = providers.find((provider) => provider.id === selection.providerId);
    if (assignedProvider) {
      const assignedModelId = findProviderModel(assignedProvider, task, selection.modelId);
      if (assignedModelId) {
        return { config: assignedProvider, modelId: assignedModelId, selection };
      }
    }
  }

  for (const provider of providers) {
    const modelId = findProviderModel(provider, task);
    if (modelId) {
      return { config: provider, modelId, selection };
    }
  }

  throw new Error(`No configured ${getTaskModelKind(task)} model found for task: ${task}`);
}

function assertProviderSupportsTask(config: ProviderConfig, task: AITaskType): void {
  if (task !== 'embedding') return;

  const providerName = config.name || config.providerType;
  if (providerConfigCanServeEmbeddings(config)) return;

  if (!providerTypeSupportsEmbeddings(config.providerType)) {
    throw new Error(
      `${providerName} does not support embeddings. Assign an embedding-capable provider in Settings -> AI.`,
    );
  }

  throw new Error(
    `${providerName} is missing an embedding model. Configure an embedding model in Settings -> AI.`,
  );
}

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

/** Get the provider for a specific task, with model id and merged inference params. */
export function getProviderForTask(
  settings: AISettings,
  task: AITaskType,
): {
  provider: AIProvider;
  modelId: string;
  inferenceParams: InferenceParams;
  config: ProviderConfig;
} {
  const { config, modelId } = resolveTaskSelection(settings, task);
  assertProviderSupportsTask(config, task);
  const provider = createProviderFromConfig(config);
  const profile = findProfileOrDefault(settings);
  const inferenceParams: InferenceParams = {
    ...TASK_INFERENCE_DEFAULTS[task],
    ...profile.inferenceParamsByTask[task],
  };
  return { provider, modelId, inferenceParams, config };
}

/** Backward-compatible helper: returns the provider selected for chat. */
export function getAIProvider(settings: AISettings): AIProvider {
  return getProviderForTask(settings, 'chat').provider;
}
