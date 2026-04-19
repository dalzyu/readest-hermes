import { useLookupPipeline } from './useLookupPipeline';
import type {
  LookupAvailabilityHint,
  LookupFieldProvenance,
  LookupPipelineDebugInfo,
} from '@/services/contextTranslation/lookupPipeline';
import type {
  ContextDictionarySettings,
  ContextTranslationSettings,
  LookupAnnotationSlots,
  LookupExample,
  PopupContextBundle,
  PopupRetrievalHints,
  RetrievalStatus,
  TranslationResult,
} from '@/services/contextTranslation/types';
import type { ValidationDecision } from '@/services/contextTranslation/validator';

export interface UseContextLookupInput {
  mode: 'translation' | 'dictionary';
  bookKey: string;
  bookHash: string;
  selectedText: string;
  currentPage: number;
  settings: ContextTranslationSettings;
  dictionarySettings?: ContextDictionarySettings;
  /** Book's primary language from epub metadata (e.g. 'en', 'ja'). Used as detection prior. */
  bookLanguage?: string;
}

export type LookupDebugInfo = LookupPipelineDebugInfo;

export interface UseContextLookupResult {
  result: TranslationResult | null;
  partialResult: TranslationResult | null;
  loading: boolean;
  streaming: boolean;
  activeFieldId: string | null;
  error: string | null;
  aiUnavailable: boolean;
  /** Text after word-boundary expansion (may differ from the raw selection). */
  expandedText: string | null;
  validationDecision: ValidationDecision | null;
  retrievalStatus: RetrievalStatus;
  retrievalHints: PopupRetrievalHints;
  popupContext: PopupContextBundle | null;
  examples: LookupExample[];
  annotations: LookupAnnotationSlots | null;
  debugInfo: LookupDebugInfo | null;
  availabilityHint: LookupAvailabilityHint;
  fieldProvenance: LookupFieldProvenance | null;
  saveToVocabulary: () => Promise<void>;
}

export function useContextLookup(input: UseContextLookupInput): UseContextLookupResult {
  return useLookupPipeline(input);
}
