import { useContextLookup, type UseContextLookupResult } from './useContextLookup';
import { resolveContextDictionaryFieldSources } from '@/services/contextTranslation/defaults';
import type {
  ContextDictionarySettings,
  ContextTranslationSettings,
  TranslationResult,
} from '@/services/contextTranslation/types';

export interface UseContextDictionaryInput {
  bookKey: string;
  bookHash: string;
  selectedText: string;
  currentPage: number;
  translationSettings: ContextTranslationSettings;
  dictionarySettings: ContextDictionarySettings;
  bookLanguage?: string;
}

function buildDictionaryFieldValue(
  dictionarySettings: ContextDictionarySettings,
  result: UseContextLookupResult,
) {
  const dictionaryDefinitions =
    result.popupContext?.dictionaryResults
      ?.map((entry) => entry.definition.trim())
      .filter(Boolean) ?? [];

  const value = dictionaryDefinitions.join('\n');
  if (!value) return null;

  return {
    simpleDefinition:
      resolveContextDictionaryFieldSources(dictionarySettings).simpleDefinition === 'dictionary'
        ? value
        : undefined,
    contextualMeaning:
      resolveContextDictionaryFieldSources(dictionarySettings).contextualMeaning === 'dictionary'
        ? value
        : undefined,
  } satisfies Partial<TranslationResult>;
}

function mergeDictionaryFields(
  fields: TranslationResult | null,
  dictionarySettings: ContextDictionarySettings,
  result: UseContextLookupResult,
): TranslationResult | null {
  const fieldSources = resolveContextDictionaryFieldSources(dictionarySettings);
  const merged = { ...(fields ?? {}) };

  if (fieldSources.sourceExamples === 'dictionary') {
    delete merged['sourceExamples'];
  }

  const dictionaryFields = buildDictionaryFieldValue(dictionarySettings, result);
  if (fieldSources.simpleDefinition === 'dictionary') {
    if (dictionaryFields?.simpleDefinition) {
      merged['simpleDefinition'] = dictionaryFields.simpleDefinition;
    } else {
      delete merged['simpleDefinition'];
    }
  }

  if (fieldSources.contextualMeaning === 'dictionary') {
    if (dictionaryFields?.contextualMeaning) {
      merged['contextualMeaning'] = dictionaryFields.contextualMeaning;
    } else {
      delete merged['contextualMeaning'];
    }
  }

  return Object.keys(merged).length > 0 ? merged : null;
}

export function useContextDictionary(input: UseContextDictionaryInput): UseContextLookupResult {
  const lookupResult = useContextLookup({
    mode: 'dictionary',
    bookKey: input.bookKey,
    bookHash: input.bookHash,
    selectedText: input.selectedText,
    currentPage: input.currentPage,
    settings: input.translationSettings,
    dictionarySettings: input.dictionarySettings,
    bookLanguage: input.bookLanguage,
  });

  return {
    ...lookupResult,
    result: mergeDictionaryFields(lookupResult.result, input.dictionarySettings, lookupResult),
    partialResult: mergeDictionaryFields(
      lookupResult.partialResult,
      input.dictionarySettings,
      lookupResult,
    ),
    examples:
      resolveContextDictionaryFieldSources(input.dictionarySettings).sourceExamples === 'dictionary'
        ? []
        : lookupResult.examples,
  };
}
