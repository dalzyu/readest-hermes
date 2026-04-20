import type { InferenceParams } from './types';

type ProviderReasoningEffort = 'none' | 'low' | 'medium' | 'high';

function toProviderReasoningEffort(
  reasoningEffort?: InferenceParams['reasoningEffort'],
): ProviderReasoningEffort | undefined {
  if (!reasoningEffort) return undefined;
  return reasoningEffort === 'off' ? 'none' : reasoningEffort;
}

export function buildInferenceOptions(params?: InferenceParams) {
  const { reasoningEffort, ...baseParams } = params ?? {};
  const providerReasoningEffort = toProviderReasoningEffort(reasoningEffort);

  return {
    ...baseParams,
    ...(providerReasoningEffort
      ? {
          providerOptions: {
            openai: { reasoningEffort: providerReasoningEffort },
            openrouter: { reasoningEffort: providerReasoningEffort },
          },
        }
      : {}),
  };
}
