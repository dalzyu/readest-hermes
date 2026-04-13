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
  /** 'production' applies repair + rescue + sanitization. 'single-pass' trusts the initial response. */
  flow: 'production' | 'single-pass';
  repairEnabled: boolean;
  repairOnContamination: boolean;
  repairOnMissingPrimary: boolean;
  repairOnLowCompletion: boolean;
  completionThreshold: number;
  maxRepairAttempts: number;
  perFieldRescueEnabled: boolean;
  maxPerFieldRepairAttempts: number;
  detectContamination: boolean;
  sanitizeOutput: boolean;
  extractChannelTail: boolean;
  extractNestedTags: boolean;
  stripReasoning: boolean;
  translationMaxWords: number;
  contaminationMarkers: string[];
  reasoningMarkers: string[];
}

/** The parsed result from the LLM, keyed by field id */
export type TranslationResult = Record<string, string>;

export interface LookupExample {
  exampleId: string;
  sourceText: string;
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

export type RetrievalStatus = 'local-only' | 'local-volume' | 'cross-volume';

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
}

/** Schema version for VocabularyEntry persistence format */
export const VOCABULARY_SCHEMA_VERSION = 2;

/** A saved example sentence linked to a vocabulary entry */
export interface VocabularyExample {
  exampleId: string;
  text: string;
}

/** A saved vocabulary lookup entry */
export interface VocabularyEntry {
  id: string;
  bookHash: string;
  term: string;
  context: string;
  result: TranslationResult;
  addedAt: number;
  reviewCount: number;
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
  mode?: 'translation' | 'dictionary';
  /** Schema version for forward-compatible reads */
  schemaVersion?: number;
  /** Source language tag, e.g. 'zh' or 'en' */
  sourceLanguage?: string;
  /** Target language tag, e.g. 'en' or 'zh' */
  targetLanguage?: string;
  /** Linked example sentences with stable annotation IDs */
  examples?: VocabularyExample[];
}

export interface BookSeriesVolume {
  bookHash: string;
  volumeIndex: number;
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
export interface ContextDictionarySettings {
  enabled: boolean;
  sourceExamples: boolean;
  /** Lookup backend: 'ai' uses the LLM (default); 'dictionary' uses bundled/user dictionaries. */
  source?: 'ai' | 'dictionary';
  /** Custom prompt instructions keyed by field id (e.g. 'simpleDefinition'). Overrides defaults. */
  promptInstructions?: Record<string, string>;
}

/** Settings for the context-aware translation feature */
export interface ContextTranslationSettings {
  enabled: boolean;
  targetLanguage: string;
  recentContextPages: number;
  lookAheadWords: number;
  sameBookRagEnabled: boolean;
  priorVolumeRagEnabled: boolean;
  sameBookChunkCount: number;
  priorVolumeChunkCount: number;
  outputFields: TranslationOutputField[];
  /** IDs of bundled dictionaries that have been explicitly disabled. */
  disabledBundledDicts?: string[];
  /** Translation source to use when looking up selected text. Defaults to 'ai'. */
  source?: 'ai' | 'dictionary' | 'azure' | 'deepl' | 'google' | 'yandex';
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
}

/** A single entry from a StarDict dictionary. */
export interface DictionaryEntry {
  headword: string;
  definition: string;
  /** Source dictionary name for display attribution. */
  source?: string;
}

/** A dictionary installed in the app. */
export interface UserDictionary {
  id: string;
  name: string;
  /** ISO 639-1 source language (headword language). */
  language: string;
  /** ISO 639-1 definition language. Same as language for monolingual. */
  targetLanguage: string;
  entryCount: number;
  source: 'bundled' | 'user';
  importedAt: number;
  /** Only when source === 'bundled'. Must match BUNDLED_DICTIONARIES version. */
  bundledVersion?: string;
  /** Whether the dictionary is enabled for lookups. Default true (undefined === enabled). */
  enabled?: boolean;
}
