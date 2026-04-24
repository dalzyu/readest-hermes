import { Book } from '@/types/book';
import { AppService } from '@/types/system';
import { useAudioSyncStore } from '@/store/audioSyncStore';

import { generateEpubMediaOverlayPackage } from './EpubMediaOverlayService';
import { useAlignmentJobStore } from './alignmentJobStore';
import { AudioSyncStartRequest, AudioSyncStatus } from './types';

const TERMINAL_PHASES = new Set(['ready', 'failed', 'cancelled']);

function appendError(errors: string[] | undefined, message: string): string[] {
  return errors?.includes(message) ? errors : [...(errors || []), message];
}

function buildPackageFailureStatus(
  book: Book,
  status: AudioSyncStatus,
  error: unknown,
  runId?: string,
): AudioSyncStatus {
  const message = error instanceof Error ? error.message : String(error);
  const now = Date.now();
  const resolvedRunId =
    status.job?.runId || status.report?.runId || runId || `package-${status.map?.id || book.hash}`;

  return {
    ...status,
    job: {
      runId: resolvedRunId,
      phase: 'failed',
      progress: status.job?.progress ?? 100,
      startedAt: status.job?.startedAt,
      updatedAt: now,
      message: 'EPUB3 package generation failed',
      error: message,
    },
    report: status.report
      ? {
          ...status.report,
          phase: 'failed',
          updatedAt: now,
          errors: appendError(status.report.errors, message),
        }
      : {
          bookHash: book.hash,
          audioHash: status.asset?.audioHash || '',
          runId: resolvedRunId,
          phase: 'failed',
          errors: [message],
          createdAt: now,
          updatedAt: now,
        },
  };
}

function shouldGeneratePackage(status: AudioSyncStatus): boolean {
  return Boolean(
    status.asset &&
    status.map &&
    !status.package &&
    (!status.job || status.job.phase === 'ready') &&
    !status.job?.error,
  );
}

export async function ensureAudioSyncPackage(
  appService: AppService,
  book: Book,
  status: AudioSyncStatus,
  runId?: string,
): Promise<AudioSyncStatus> {
  if (!shouldGeneratePackage(status)) {
    return status;
  }

  try {
    await generateEpubMediaOverlayPackage(
      appService,
      book,
      status.asset!,
      status.map!,
      status.report,
    );
    return await appService.getAudioSyncStatus(book, runId);
  } catch (error) {
    return buildPackageFailureStatus(book, status, error, runId);
  }
}

export async function startAudioAlignment(
  appService: AppService,
  book: Book,
  request?: AudioSyncStartRequest,
): Promise<AudioSyncStatus> {
  const job = await appService.startAudioSync(book, request);
  useAlignmentJobStore.getState().setActiveRun(book.hash, job.runId);
  useAudioSyncStore.getState().setAudioSyncJob(book.hash, job);
  return await pollAudioAlignmentStatus(appService, book, job.runId);
}

export async function pollAudioAlignmentStatus(
  appService: AppService,
  book: Book,
  runId: string,
): Promise<AudioSyncStatus> {
  useAlignmentJobStore.getState().setPolling(book.hash, true);
  try {
    let status = await appService.getAudioSyncStatus(book, runId);
    status = await ensureAudioSyncPackage(appService, book, status, runId);
    useAudioSyncStore.getState().setStatus(book.hash, status);
    if (status.job?.phase && TERMINAL_PHASES.has(status.job.phase)) {
      useAlignmentJobStore.getState().clearActiveRun(book.hash);
    }
    return status;
  } finally {
    useAlignmentJobStore.getState().setPolling(book.hash, false);
  }
}

export async function cancelAudioAlignment(appService: AppService, book: Book): Promise<void> {
  const runId = useAlignmentJobStore.getState().activeRuns[book.hash];
  if (!runId) {
    return;
  }
  await appService.cancelAudioSync(book, runId);
  useAlignmentJobStore.getState().clearActiveRun(book.hash);
  useAudioSyncStore.getState().setAudioSyncJob(book.hash, {
    runId,
    phase: 'cancelled',
    progress: 0,
    updatedAt: Date.now(),
  });
}
