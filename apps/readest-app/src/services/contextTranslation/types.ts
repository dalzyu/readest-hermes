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

/** A saved vocabulary lookup entry */
export interface VocabularyEntry {
  id: string;
  bookHash: string;
  term: string;
  context: string;
  result: TranslationResult;
  addedAt: number;
  reviewCount: number;
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
}
