import { useContextLookup, type UseContextLookupResult } from './useContextLookup';
import type {
  ContextDictionarySettings,
  ContextTranslationSettings,
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

export function useContextDictionary(input: UseContextDictionaryInput): UseContextLookupResult {
  return useContextLookup({
    mode: 'dictionary',
    bookKey: input.bookKey,
    bookHash: input.bookHash,
    selectedText: input.selectedText,
    currentPage: input.currentPage,
    settings: input.translationSettings,
    dictionarySettings: input.dictionarySettings,
    bookLanguage: input.bookLanguage,
  });
}
