export type AudioSyncMapVersion = 2;

export type AudioAssetFormat = 'm4b' | 'm4a' | 'mp3';
export type AudioSyncGranularity = 'chapter' | 'sentence' | 'word';
export type AudioSyncMapStatus = 'ready' | 'partial';
export type AudioSyncFollowMode = 'audio' | 'text';
export type AudioSyncPlaybackState = 'idle' | 'loading' | 'playing' | 'paused' | 'error';
export type AudioSyncStage = 'none' | 'legacy' | 'intermediate' | 'ready';
export type AudioSyncPackageVersion = 1;
export type AudioSyncJobPhase =
  | 'pending'
  | 'importing'
  | 'transcribing'
  | 'matching'
  | 'aligning'
  | 'compacting'
  | 'ready'
  | 'failed'
  | 'cancelled';

export interface BookAudioChapter {
  index: number;
  title?: string;
  startMs: number;
  endMs?: number;
}

export interface BookAudioAsset {
  id: string;
  bookHash: string;
  audioHash: string;
  originalPath: string;
  originalFilename: string;
  normalizedPath?: string;
  format: AudioAssetFormat;
  normalizedFormat?: AudioAssetFormat;
  title?: string;
  narrator?: string;
  durationMs?: number;
  chapterCount?: number;
  chapters?: BookAudioChapter[];
  createdAt: number;
  updatedAt: number;
}

export interface AudioSyncCoverage {
  matchedChars: number;
  totalChars: number;
  matchedRatio: number;
}

export interface AudioSyncConfidence {
  overall: number;
  byChapter: Record<string, number>;
}

export interface AudioSyncWord {
  id: string;
  sectionHref: string;
  cfiStart: string;
  cfiEnd: string;
  text: string;
  textStartOffset?: number;
  textEndOffset?: number;
  audioStartMs: number;
  audioEndMs: number;
  confidence: number;
}

export interface AudioSyncSegment {
  id: string;
  sectionHref: string;
  cfiStart: string;
  cfiEnd: string;
  text: string;
  textStartOffset?: number;
  textEndOffset?: number;
  audioStartMs: number;
  audioEndMs: number;
  confidence: number;
  words?: AudioSyncWord[];
}

export interface AudioSyncMap {
  id: string;
  version: AudioSyncMapVersion;
  bookHash: string;
  audioHash: string;
  language?: string;
  granularity: AudioSyncGranularity;
  status: AudioSyncMapStatus;
  coverage: AudioSyncCoverage;
  confidence: AudioSyncConfidence;
  segments: AudioSyncSegment[];
  createdAt: number;
  updatedAt: number;
}

export interface AudioAlignmentReport {
  bookHash: string;
  audioHash: string;
  runId: string;
  phase: AudioSyncJobPhase;
  model?: string;
  device?: string;
  coverage?: AudioSyncCoverage;
  confidence?: AudioSyncConfidence;
  warnings?: string[];
  errors?: string[];
  createdAt: number;
  updatedAt: number;
}

export interface AudioSyncPackageValidationDiagnostic {
  code: string;
  message: string;
  severity: 'error' | 'warning';
  path?: string;
}

export interface AudioSyncPackageValidation {
  valid: boolean;
  checkedAt: number;
  diagnostics: AudioSyncPackageValidationDiagnostic[];
}

export interface AudioSyncGeneratedPackage {
  version: AudioSyncPackageVersion;
  generator: string;
  bookHash: string;
  audioHash: string;
  syncMapId: string;
  syncMapVersion: AudioSyncMapVersion;
  packagePath: string;
  audioPath: string;
  audioFileName: string;
  sizeBytes: number;
  createdAt: number;
  updatedAt: number;
  report?: Pick<
    AudioAlignmentReport,
    'runId' | 'phase' | 'model' | 'device' | 'warnings' | 'errors'
  >;
  validation: AudioSyncPackageValidation;
}

export interface AudioSyncStartRequest {
  transcriptPath?: string;
  outputPath?: string;
  /** WhisperX model ID, e.g. 'large-v3', 'small.en'. Defaults to 'large-v3' in helper. */
  model?: string;
}

export interface AudioSyncJobStatus {
  runId: string;
  phase: AudioSyncJobPhase;
  progress: number;
  startedAt?: number;
  updatedAt: number;
  message?: string;
  error?: string;
}

export interface AudioSyncSessionState {
  bookHash: string;
  audioAssetId: string | null;
  syncMapId: string | null;
  mode: AudioSyncPlaybackState;
  followMode: AudioSyncFollowMode;
  currentTimeMs: number;
  durationMs: number;
  activeSegmentId: string | null;
  activeWordId?: string | null;
  playbackRate: number;
  lastError?: string;
}

export interface AudioSyncStatus {
  asset: BookAudioAsset | null;
  map: AudioSyncMap | null;
  job: AudioSyncJobStatus | null;
  report: AudioAlignmentReport | null;
  package?: AudioSyncGeneratedPackage | null;
  playable: boolean;
  synced: boolean;
  chapterFallback: boolean;
  syncStage: AudioSyncStage;
}

// ── Correction sidecars ────────────────────────────────────────────────────

/** Manual correction applied to a single audiobook chapter. */
export interface AudioSyncChapterCorrection {
  /** Audio chapter index (from BookAudioChapter.index). */
  audioChapterIndex: number;
  /**
   * Optional target book TOC section index override.
   * When set, the alignment engine should prefer mapping this audio chapter
   * to the specified section instead of auto-detected section.
   */
  sectionIndexOverride?: number;
  /**
   * Millisecond offset added to all audio timestamps in this chapter.
   * Positive values shift audio forward; negative shift it back.
   */
  audioOffsetMs?: number;
  /** If true, this chapter is treated as non-book audio (intro/outro/ads). */
  nonBookAudio?: boolean;
  /** Human-readable note describing why the correction was applied. */
  note?: string;
}

/**
 * Locally stored correction sidecar for a synced book-audio pair.
 * Corrections are applied on the next regeneration run; they do not
 * automatically invalidate an existing generated EPUB3 package but they
 * mark affected chapters as stale so the UI can prompt for regeneration.
 */
export interface AudioSyncCorrectionSidecar {
  bookHash: string;
  audioHash: string;
  corrections: AudioSyncChapterCorrection[];
  createdAt: number;
  updatedAt: number;
}
