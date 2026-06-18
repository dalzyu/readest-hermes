import type { InferenceParams } from '@/services/ai/types';

export type { InferenceParams };
import type { LookupSettings } from './settings';

export type LookupSource = 'ai' | 'translator' | 'dictionary' | 'corpus';
export type LookupMode = 'translation' | 'dictionary';

/** A single configurable output field shown in the translation popup */
export interface TranslationOutputField {
  id: string;
  label: string;
  enabled: boolean;
  order: number;
  /** Injected into the LLM prompt to describe what this field should contain */
  promptInstruction: string;
}

export interface ContextTranslationHarnessSettings {
  /** Production-only harness. Legacy single-pass values are normalized away on load. */
  flow: 'production';
  repairEnabled: boolean;
  repairOnContamination: boolean;
  repairOnMissingPrimary: boolean;
  repairOnLowCompletion: boolean;
  completionThreshold: number;
  maxRepairAttempts: number;
  perFieldRescueEnabled: boolean;
  maxPerFieldRepairAttempts: number;
  maxTotalLLMCalls?: number;
  detectContamination: boolean;
  sanitizeOutput: boolean;
  extractChannelTail: boolean;
  extractNestedTags: boolean;
  stripReasoning: boolean;
  translationMaxWords: number;
  contaminationMarkers: string[];
  reasoningMarkers: string[];
  /**
   * Extra contamination markers merged with the defaults in `resolveContextTranslationHarnessSettings`.
   * Use this to extend the default list without replicating it.
   */
  additionalContaminationMarkers?: string[];
  /**
   * Extra reasoning markers merged with the defaults in `resolveContextTranslationHarnessSettings`.
   * Use this to extend the default list without replicating it.
   */
  additionalReasoningMarkers?: string[];
}

/** The parsed result from the LLM, keyed by field id */
export type TranslationResult = Record<string, string>;

export interface LookupExample {
  text?: string;
  translation?: string;
  source?: LookupSource | 'ai' | 'corpus' | 'dictionary';
  /** Legacy stable annotation id used by existing popup utilities. */
  exampleId: string;
  /** Legacy source sentence field used by old lookup rendering. */
  sourceText: string;
  /** Legacy translated sentence field used by old lookup rendering. */
  targetText: string;
}

export type LookupAnnotations = {
  phonetic?: string;
  examples?: Record<string, { phonetic?: string }>;
};

export type LookupAnnotationSlots = {
  source?: LookupAnnotations;
  target?: LookupAnnotations;
};

/** 'idle' = no lookup has completed yet (pre-lookup initial state). */
export type RetrievalStatus = 'idle' | 'local-only' | 'local-volume' | 'cross-volume';

export type FieldSource = 'ai' | 'translator' | 'dictionary' | 'corpus';
export type ProvenanceValue = FieldSource | 'aiUnavailable' | 'empty';

export interface LookupFieldProvenanceEntry {
  source: ProvenanceValue;
  language?: string;
}

export type LookupFieldProvenance = Record<string, LookupFieldProvenanceEntry>;
export interface TranslationStreamResult {
  fields: TranslationResult;
  activeFieldId: string | null;
  rawText: string;
  done: boolean;
}

/** Input passed to the translation service for a single lookup */
export interface TranslationRequest {
  /** The selected text to translate */
  selectedText: string;
  /** Structured popup context sections passed to the prompt */
  popupContext: PopupContextBundle;
  /** Source language (e.g. "zh", "ja"). Auto-detected if omitted. */
  sourceLanguage?: string;
  /** Target language for translation (e.g. "en") */
  targetLanguage: string;
  /** Fields to populate in the response */
  outputFields: TranslationOutputField[];
  /** Optional runtime controls for repair / rescue / sanitization. */
  harness?: Partial<ContextTranslationHarnessSettings>;
  /** Optional Jinja-style template override for the lookup system prompt. */
  systemPromptTemplate?: string;
  /** Optional generation overrides for the active AI provider. */
  inferenceParams?: InferenceParams;
}

/** Schema version for VocabularyEntry persistence format */
export const VOCABULARY_SCHEMA_VERSION = 2;

/** A saved example sentence linked to a vocabulary entry */
export interface VocabularyExample {
  text: string;
  translation?: string;
  source?: LookupSource;
  /** Legacy stable annotation id used by existing review UI. */
  exampleId?: string;
}

/** A saved vocabulary lookup entry */
export interface VocabularyEntry {
  id: string;
  bookHash: string;
  term: string;
  context: string;
  result: TranslationResult;
  addedAt: number;
  updatedAt?: number;
  reviewCount: number;
  sourceLanguage?: string;
  targetLanguage?: string;
  /** SM-2 review scheduling metadata; optional so legacy entries remain readable. */
  dueAt?: number;
  /** SM-2 interval in days. */
  intervalDays?: number;
  /** SM-2 ease factor. */
  easeFactor?: number;
  /** Consecutive successful reviews. */
  repetition?: number;
  /** Unix ms timestamp of the last review. */
  lastReviewedAt?: number;
  /** Lookup mode that produced this entry ('translation' | 'dictionary') */
  mode?: LookupMode;
  /** Schema version for forward-compatible reads */
  schemaVersion?: number;
  /** Linked example sentences with stable annotation IDs */
  examples?: VocabularyExample[];
}

export interface BookSeriesVolume {
  bookHash: string;
  title?: string;
  author?: string;
  order?: number;
  /** Legacy ordering field persisted by existing series records. */
  volumeIndex: number;
  /** Legacy label field persisted by existing series records. */
  label?: string;
}

/** An ordered collection of books treated as a series for cross-volume RAG */
export interface BookSeries {
  id: string;
  name: string;
  volumes: BookSeriesVolume[];
  createdAt: number;
  updatedAt: number;
}

export interface PopupRetrievalHints {
  currentVolumeIndexed: boolean;
  missingLocalIndex: boolean;
  missingPriorVolumes: number[];
  missingSeriesAssignment: boolean;
  embeddingUnavailable?: boolean;
}

/** A dictionary result for immediate display in the popup (no LLM required). */
export interface DictionaryDisplayEntry {
  headword: string;
  definition: string;
  source: string; // e.g., "CC-CEDICT", "JMdict", user dictionary name
}

export interface PopupContextBundle {
  localPastContext: string;
  localFutureBuffer: string;
  sameBookChunks: string[];
  priorVolumeChunks: string[];
  retrievalStatus: RetrievalStatus;
  retrievalHints: PopupRetrievalHints;
  dictionaryEntries: string[];
  /** Structured dictionary results for immediate popup display */
  dictionaryResults?: DictionaryDisplayEntry[];
}

/** Settings for the source-language dictionary lookup feature */
export type ContextDictionaryPrimaryFieldSource = 'ai' | 'dictionary';
export type ContextDictionaryExampleFieldSource = 'ai' | 'corpus' | 'dictionary';
export type ContextDictionaryFieldSource =
  | ContextDictionaryPrimaryFieldSource
  | ContextDictionaryExampleFieldSource;

export interface ContextDictionaryFieldSources {
  simpleDefinition?: ContextDictionaryPrimaryFieldSource;
  contextualMeaning?: ContextDictionaryPrimaryFieldSource;
  sourceExamples?: ContextDictionaryExampleFieldSource;
}

export interface ContextDictionarySettings {
  enabled: boolean;
  sourceExamples: boolean;
  fieldSources?: ContextDictionaryFieldSources;
  /** Lookup backend: 'ai' uses the LLM (default); 'dictionary' uses bundled/user dictionaries. */
  source?: 'ai' | 'dictionary';
  /** Custom prompt instructions keyed by field id (e.g. 'simpleDefinition'). Overrides defaults. */
  promptInstructions?: Record<string, string>;
  /** Optional Jinja-style template override for the dictionary system prompt. */
  systemPromptTemplate?: string;
}

export interface ContextTranslationFieldSources {
  translation?: 'ai' | 'translator' | 'dictionary';
  contextualMeaning?: 'ai' | 'dictionary';
  examples?: 'ai' | 'corpus';
  grammarHint?: 'ai';
}

/** Settings for the context-aware translation feature */
export interface ContextTranslationSettings {
  enabled: boolean;
  targetLanguage: string;
  /** Whether to run reference dictionary lookups and inject results into AI prompts (default: true). */
  referenceDictionaryEnabled?: boolean;
  recentContextPages: number;
  lookAheadWords: number;
  sameBookRagEnabled: boolean;
  priorVolumeRagEnabled: boolean;
  sameBookChunkCount: number;
  priorVolumeChunkCount: number;
  outputFields: TranslationOutputField[];

  /** Per-field source routing for translation mode. */
  fieldSources?: ContextTranslationFieldSources;
  /**
   * @deprecated Legacy source flag. Migrated to fieldSources.translation on load.
   */
  source?: 'ai' | 'dictionary';
  /**
   * Field strategy:
   * - 'single' (default) = one LLM call with all fields in a single prompt
   * - 'multi' = per-field prompts with parallel LLM calls
   */
  fieldStrategy?: 'single' | 'multi';
  /** Auto-expand selection to word boundaries before lookup (default: true). */
  autoExpandSelection?: boolean;
  /** Advanced repair / rescue / sanitization controls for the translation harness. */
  harness?: Partial<ContextTranslationHarnessSettings>;
  /** Optional Jinja-style template override for the translation system prompt. */
  systemPromptTemplate?: string;
}

export interface DictionaryEntry {
  term?: string;
  definition: string;
  reading?: string;
  partOfSpeech?: string;
  examples?: LookupExample[];
  /** Legacy headword field used by existing dictionary rendering. */
  headword: string;
  /** Source dictionary name for display attribution. */
  source?: string;
}

/** A dictionary installed in the app. */
export interface UserDictionary {
  id: string;
  name: string;
  sourceLanguage?: string;
  targetLanguage: string;
  entryCount: number;
  enabled?: boolean;
  importedAt: number;
  /** Legacy ISO 639-1 source language field. */
  language: string;
  /** Legacy source flag for bundled/user dictionaries. */
  source?: 'bundled' | 'user';
  /** Only when source === 'bundled'. Must match BUNDLED_DICTIONARIES version. */
  bundledVersion?: string;
}

export interface FrequencyBadge {
  level: string;
  rank?: number;
  source: string;
}

export interface LookupResult {
  term: string;
  mode: LookupMode;
  sourceLanguage: string;
  targetLanguage: string;
  translation?: string;
  dictionaryEntries: DictionaryEntry[];
  examples: LookupExample[];
  grammarHint?: string;
  phonetic?: string;
  frequencyBadge?: FrequencyBadge;
  provenance: Partial<
    Record<
      'translation' | 'dictionary' | 'examples' | 'grammarHint' | 'frequencyBadge',
      LookupSource
    >
  >;
}

export interface LookupContext {
  localPastContext: string;
  localFutureBuffer: string;
  currentPage?: number;
  maxPage?: number;
}

export interface LookupRequest {
  bookKey: string;
  bookHash: string;
  selectedText: string;
  mode: LookupMode;
  targetLanguage: string;
  context?: LookupContext;
  signal?: AbortSignal;
  /** Caller-resolved lookup settings; when omitted, no preferred translator is used. */
  lookupSettings?: LookupSettings;
  /** Caller-resolved installed dictionaries; when omitted, no user dictionaries are searched. */
  installedDictionaries?: UserDictionary[];
}

export interface LookupHistoryEntry {
  id: string;
  recordedAt: number;
  bookHash: string;
  term: string;
  context: string;
  result: LookupResult;
  mode: LookupMode;
  location?: string;
}
