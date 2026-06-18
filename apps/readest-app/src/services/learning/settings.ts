import type { UserDictionary } from '@/services/learning/types';
import type { TranslatorName } from './translator/providers/index';
export type { TranslatorName };

export interface LookupSettings {
  enabled: boolean;
  targetLanguage: string;
  translatorProvider: TranslatorName;
  showExamples: boolean;
  showGrammarHints: boolean;
  showFrequencyBadges: boolean;
}

export interface DictionarySettings {
  enabled: boolean;
  dictionaries: UserDictionary[];
  fuzzyLookup: boolean;
}

export const DEFAULT_LOOKUP_SETTINGS: LookupSettings = {
  enabled: false,
  targetLanguage: 'en',
  translatorProvider: 'deepl',
  showExamples: true,
  showGrammarHints: true,
  showFrequencyBadges: true,
};

export const DEFAULT_DICTIONARY_SETTINGS: DictionarySettings = {
  enabled: true,
  dictionaries: [],
  fuzzyLookup: true,
};

export function normalizeLookupSettings(
  value: Partial<LookupSettings> | undefined,
): LookupSettings {
  return { ...DEFAULT_LOOKUP_SETTINGS, ...(value ?? {}) };
}

export function normalizeDictionarySettings(
  value: Partial<DictionarySettings> | undefined,
): DictionarySettings {
  return {
    ...DEFAULT_DICTIONARY_SETTINGS,
    ...(value ?? {}),
    dictionaries: Array.isArray(value?.dictionaries) ? value.dictionaries : [],
  };
}
