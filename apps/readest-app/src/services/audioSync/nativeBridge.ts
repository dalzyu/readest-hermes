import { invoke } from '@tauri-apps/api/core';

export interface InspectAudioMetadataRequest {
  audioPath: string;
}

export interface AudioChapterSummary {
  index: number;
  title?: string;
  startMs: number;
  endMs?: number;
}

export interface AudioMetadataSummary {
  audioPath: string;
  title?: string;
  durationMs?: number;
  sampleRateHz?: number;
  channels?: number;
  bitrateKbps?: number;
  chapterCount?: number;
  chapters: AudioChapterSummary[];
}

export interface ImportAudioMetadataRequest {
  audioPath: string;
  metadataPath: string;
}

export interface AudioMetadataImportResult {
  audioPath: string;
  metadataPath: string;
  importedFields: string[];
}

export interface StartAlignmentJobRequest {
  bookHash: string;
  audioHash: string;
  audioPath: string;
  transcriptPath?: string;
  outputPath?: string;
  reportPath?: string;
  model?: string;
}

export interface AudioAlignmentJobHandle {
  jobId: string;
}

export interface ReadAlignmentJobStatusRequest {
  jobId: string;
}

export type NativeAudioAlignmentJobState =
  | 'queued'
  | 'running'
  | 'succeeded'
  | 'failed'
  | 'cancelled';
export type NativeAudioAlignmentJobPhase =
  | 'pending'
  | 'importing'
  | 'matching'
  | 'aligning'
  | 'compacting'
  | 'ready'
  | 'failed'
  | 'cancelled';

export interface NativeAudioAlignmentJobStatus {
  jobId: string;
  state: NativeAudioAlignmentJobState;
  phase?: NativeAudioAlignmentJobPhase;
  progress?: number;
  detail?: string;
}

export interface CancelAlignmentJobRequest {
  jobId: string;
}

export interface CancelAlignmentJobResult {
  jobId: string;
  cancelled: boolean;
}

export async function inspectAudioMetadata(
  request: InspectAudioMetadataRequest,
): Promise<AudioMetadataSummary> {
  return invoke<AudioMetadataSummary>('inspect_audio_metadata', { request });
}

export async function importAudioMetadata(
  request: ImportAudioMetadataRequest,
): Promise<AudioMetadataImportResult> {
  return invoke<AudioMetadataImportResult>('import_audio_metadata', { request });
}

export async function startAlignmentJob(
  request: StartAlignmentJobRequest,
): Promise<AudioAlignmentJobHandle> {
  return invoke<AudioAlignmentJobHandle>('start_alignment_job', { request });
}

export async function readAlignmentJobStatus(
  request: ReadAlignmentJobStatusRequest,
): Promise<NativeAudioAlignmentJobStatus> {
  return invoke<NativeAudioAlignmentJobStatus>('read_alignment_job_status', { request });
}

export async function cancelAlignmentJob(
  request: CancelAlignmentJobRequest,
): Promise<CancelAlignmentJobResult> {
  return invoke<CancelAlignmentJobResult>('cancel_alignment_job', { request });
}

// ── Helper runtime status ─────────────────────────────────────────────────────

export type AudioSyncHelperState =
  | { state: 'notInstalled' }
  | { state: 'devMode'; pythonPath: string }
  | { state: 'ready'; helperDir: string; version: string }
  | { state: 'failed'; reason: string };

export interface AudioSyncHelperStatus {
  state: AudioSyncHelperState;
  platform: string;
  appManagedDir?: string;
}

export async function getAudioSyncHelperStatus(): Promise<AudioSyncHelperStatus> {
  return invoke<AudioSyncHelperStatus>('get_audio_sync_helper_status');
}

export async function installAudioSyncHelper(): Promise<void> {
  return invoke<void>('install_audio_sync_helper');
}

export async function removeAudioSyncHelper(): Promise<void> {
  return invoke<void>('remove_audio_sync_helper');
}
