import { OllamaProvider } from './OllamaProvider';
import { AIGatewayProvider } from './AIGatewayProvider';
import { OpenAICompatibleProvider } from './OpenAICompatibleProvider';
import { AnthropicProvider } from './AnthropicProvider';
import { GoogleProvider } from './GoogleProvider';
import { OpenRouterProvider } from './OpenRouterProvider';
import { GenericSdkProvider } from './GenericSdkProvider';
import type { AIProvider, AISettings, ProviderConfig, AITaskType, InferenceParams } from '../types';
import { TASK_INFERENCE_DEFAULTS } from '../types';

export {
  OllamaProvider,
  AIGatewayProvider,
  OpenAICompatibleProvider,
  AnthropicProvider,
  GoogleProvider,
  OpenRouterProvider,
  GenericSdkProvider,
};

// ---------------------------------------------------------------------------
// Provider instantiation from a single ProviderConfig
// ---------------------------------------------------------------------------

export function createProviderFromConfig(config: ProviderConfig): AIProvider {
  switch (config.providerType) {
    case 'ollama':
      return new OllamaProvider(config);
    case 'ai-gateway':
      return new AIGatewayProvider(config);
    case 'openai':
    case 'openai-compatible':
      return new OpenAICompatibleProvider(config);
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

// ---------------------------------------------------------------------------
// Resolve which ProviderConfig applies for a given task
// ---------------------------------------------------------------------------

function resolveProviderConfig(settings: AISettings, task?: AITaskType): ProviderConfig {
  const { providers, activeProviderId, modelAssignments } = settings;
  if (!providers.length) {
    throw new Error('No AI providers configured');
  }

  // Check task-specific assignment first
  const assignedId = task ? modelAssignments[task] : undefined;
  if (assignedId) {
    const assigned = providers.find((p) => p.id === assignedId);
    if (assigned) return assigned;
  }

  // Fall back to the active provider
  const active = providers.find((p) => p.id === activeProviderId);
  if (active) return active;

  // Last resort: first in list
  return providers[0]!;
}

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

/** Get the provider for a specific task, with merged inference params. */
export function getProviderForTask(
  settings: AISettings,
  task: AITaskType,
): { provider: AIProvider; inferenceParams: InferenceParams } {
  const config = resolveProviderConfig(settings, task);
  const provider = createProviderFromConfig(config);
  const inferenceParams: InferenceParams = {
    ...TASK_INFERENCE_DEFAULTS[task],
    ...config.inferenceParams,
  };
  return { provider, inferenceParams };
}

/** Backward-compatible: returns the active provider (translation task). */
export function getAIProvider(settings: AISettings): AIProvider {
  const config = resolveProviderConfig(settings);
  return createProviderFromConfig(config);
}
