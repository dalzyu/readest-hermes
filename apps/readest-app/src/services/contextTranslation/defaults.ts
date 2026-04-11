import type {
  ContextDictionarySettings,
  ContextTranslationSettings,
  TranslationOutputField,
} from './types';
export { CONTEXT_LOOKUP_MODES } from './modes';

export const DEFAULT_CONTEXT_TRANSLATION_SETTINGS: ContextTranslationSettings = {
  enabled: false,
  targetLanguage: 'en',
  recentContextPages: 3,
  lookAheadWords: 80,
  sameBookRagEnabled: true,
  priorVolumeRagEnabled: true,
  sameBookChunkCount: 3,
  priorVolumeChunkCount: 2,
  outputFields: [
    {
      id: 'translation',
      label: 'Translation',
      enabled: true,
      order: 0,
      promptInstruction:
        'Provide a concise, direct translation of the selected text into the target language.',
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
        'Provide 2–3 short example sentences using the selected term in similar contexts.',
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

export const DEFAULT_CONTEXT_DICTIONARY_SETTINGS: ContextDictionarySettings = {
  enabled: false,
  sourceExamples: true,
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
  return DEFAULT_CONTEXT_DICTIONARY_OUTPUT_FIELDS.map((field) => ({
    ...field,
    enabled: field.id === 'sourceExamples' ? settings.sourceExamples : field.enabled,
    promptInstruction: custom[field.id] ?? field.promptInstruction,
  }));
}
