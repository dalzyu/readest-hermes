/** A single configurable output field shown in the translation popup */
export interface TranslationOutputField {
  id: string;
  label: string;
  enabled: boolean;
  order: number;
  /** Injected into the LLM prompt to describe what this field should contain */
  promptInstruction: string;
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

export interface PopupContextBundle {
  localPastContext: string;
  localFutureBuffer: string;
  sameBookChunks: string[];
  priorVolumeChunks: string[];
  retrievalStatus: RetrievalStatus;
  retrievalHints: PopupRetrievalHints;
  dictionaryEntries: string[];
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
}

/** A single entry from a StarDict dictionary. */
export interface DictionaryEntry {
  headword: string;
  definition: string;
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
