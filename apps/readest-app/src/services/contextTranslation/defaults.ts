import type { ContextTranslationSettings } from './types';

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
  ],
};
