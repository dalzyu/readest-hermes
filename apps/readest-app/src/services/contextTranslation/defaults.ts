import type {
  ContextDictionaryFieldSources,
  ContextDictionarySettings,
  ContextTranslationHarnessSettings,
  ContextTranslationSettings,
  TranslationOutputField,
} from './types';
export { CONTEXT_LOOKUP_MODES } from './modes';

export const DEFAULT_CONTEXT_TRANSLATION_HARNESS_SETTINGS: ContextTranslationHarnessSettings = {
  flow: 'production',
  repairEnabled: true,
  repairOnContamination: true,
  repairOnMissingPrimary: true,
  repairOnLowCompletion: true,
  completionThreshold: 0.5,
  maxRepairAttempts: 1,
  perFieldRescueEnabled: true,
  maxPerFieldRepairAttempts: 1,
  maxTotalLLMCalls: 3,
  detectContamination: true,
  sanitizeOutput: true,
  extractChannelTail: true,
  extractNestedTags: true,
  stripReasoning: true,
  translationMaxWords: 8,
  contaminationMarkers: [
    'Thinking Process',
    'Thought Process',
    'The user wants me',
    'Analyze the Request',
    "Here's a thinking process",
    "Here's a plan",
    'Confidence Score',
    '<channel|>',
  ],
  reasoningMarkers: [
    "Here's a thinking process",
    "Here's a plan",
    'Thinking Process',
    'Thought Process',
    'The user wants me',
    'Analyze the Request',
    'Analyze the source',
    'Let me',
    'Goal:',
    'Task:',
    'Final polish',
    'Draft:',
    'Self-correction',
    'Role:',
    'Source:',
    'Context:',
  ],
};

export function resolveContextTranslationHarnessSettings(
  harness?: Partial<ContextTranslationHarnessSettings>,
): ContextTranslationHarnessSettings {
  return {
    ...DEFAULT_CONTEXT_TRANSLATION_HARNESS_SETTINGS,
    ...harness,
    flow: 'production',
    contaminationMarkers:
      harness?.contaminationMarkers ??
      DEFAULT_CONTEXT_TRANSLATION_HARNESS_SETTINGS.contaminationMarkers,
    reasoningMarkers:
      harness?.reasoningMarkers ?? DEFAULT_CONTEXT_TRANSLATION_HARNESS_SETTINGS.reasoningMarkers,
  };
}

export const DEFAULT_CONTEXT_TRANSLATION_SETTINGS: ContextTranslationSettings = {
  enabled: false,
  targetLanguage: 'en',
  referenceDictionaryEnabled: true,
  recentContextPages: 3,
  lookAheadWords: 80,
  sameBookRagEnabled: true,
  priorVolumeRagEnabled: true,
  sameBookChunkCount: 3,
  priorVolumeChunkCount: 2,
  harness: DEFAULT_CONTEXT_TRANSLATION_HARNESS_SETTINGS,
  outputFields: [
    {
      id: 'translation',
      label: 'Translation',
      enabled: true,
      order: 0,
      promptInstruction:
        'Provide ONLY the translated word or short phrase in the target language (1-3 words maximum). Do NOT include explanations, alternatives, parentheticals, or meta-commentary. If there is no exact equivalent, choose the single closest concept.',
    },
    {
      id: 'contextualMeaning',
      label: 'Contextual Meaning',
      enabled: true,
      order: 1,
      promptInstruction:
        'Explain what the selected word or phrase specifically means given the surrounding narrative context. Note any nuances, connotations, or cultural significance that differ from a generic dictionary definition.',
    },
    {
      id: 'examples',
      label: 'Usage Examples',
      enabled: false,
      order: 2,
      promptInstruction:
        'Provide 2-3 short example sentences in the TARGET LANGUAGE that use the translated word or phrase naturally. Every sentence must be written entirely in the target language. Do NOT use the source word in examples.',
    },
    {
      id: 'grammarHint',
      label: 'Grammar',
      enabled: false,
      order: 3,
      promptInstruction:
        'Briefly state the grammatical role of the selected text in this sentence (e.g. part of speech, tense, mood, case). Keep it to one short line.',
    },
  ],
};

export const DEFAULT_CONTEXT_DICTIONARY_FIELD_SOURCES: Required<ContextDictionaryFieldSources> = {
  simpleDefinition: 'dictionary',
  contextualMeaning: 'ai',
  sourceExamples: 'ai',
};

export function resolveContextDictionaryFieldSources(
  settings?: ContextDictionarySettings,
): Required<ContextDictionaryFieldSources> {
  return {
    ...DEFAULT_CONTEXT_DICTIONARY_FIELD_SOURCES,
    ...settings?.fieldSources,
  };
}

export const DEFAULT_CONTEXT_DICTIONARY_SETTINGS: ContextDictionarySettings = {
  enabled: false,
  sourceExamples: true,
  fieldSources: DEFAULT_CONTEXT_DICTIONARY_FIELD_SOURCES,
};

export const DEFAULT_CONTEXT_DICTIONARY_OUTPUT_FIELDS: ReadonlyArray<TranslationOutputField> = [
  {
    id: 'simpleDefinition',
    label: 'Simple Definition',
    enabled: true,
    order: 0,
    promptInstruction:
      'Explain the selected text in simpler source-language terms without translating away from the source language.',
  },
  {
    id: 'contextualMeaning',
    label: 'Contextual Meaning',
    enabled: true,
    order: 1,
    promptInstruction:
      'Explain what the selected text means in this passage, still using the source language.',
  },
  {
    id: 'sourceExamples',
    label: 'Source Examples',
    enabled: true,
    order: 2,
    promptInstruction:
      'Provide 1 or 2 short example sentences in the source language that use the selected text naturally.',
  },
];

export function getContextDictionaryOutputFields(
  settings: ContextDictionarySettings,
): TranslationOutputField[] {
  const custom = settings.promptInstructions ?? {};
  const fieldSources = resolveContextDictionaryFieldSources(settings);

  return DEFAULT_CONTEXT_DICTIONARY_OUTPUT_FIELDS.map((field) => {
    const enabled =
      field.id === 'simpleDefinition'
        ? fieldSources.simpleDefinition === 'ai'
        : field.id === 'contextualMeaning'
          ? fieldSources.contextualMeaning === 'ai'
          : settings.sourceExamples && fieldSources.sourceExamples === 'ai';

    return {
      ...field,
      enabled,
      promptInstruction: custom[field.id] ?? field.promptInstruction,
    };
  });
}
