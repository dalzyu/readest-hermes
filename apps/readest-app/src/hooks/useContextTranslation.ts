import { useLookupPipeline, type UseContextLookupResult } from './useLookupPipeline';
import type { ContextTranslationSettings } from '@/services/learning/types';

interface UseContextTranslationOptions {
  bookKey: string;
  bookHash: string;
  selectedText: string;
  currentPage: number;
  settings: ContextTranslationSettings;
  bookLanguage?: string;
}

export type UseContextTranslationResult = UseContextLookupResult;

export function useContextTranslation({
  bookKey,
  bookHash,
  selectedText,
  currentPage,
  settings,
  bookLanguage,
}: UseContextTranslationOptions): UseContextTranslationResult {
  return useLookupPipeline({
    mode: 'translation',
    bookKey,
    bookHash,
    selectedText,
    currentPage,
    settings,
    bookLanguage,
  });
}
