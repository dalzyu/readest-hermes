import { Book } from '@/types/book';
import { AppService } from '@/types/system';
import { useAudioSyncStore } from '@/store/audioSyncStore';

import { listenAudioSyncJobStatus } from './nativeBridge';
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
  const status = await appService.getAudioSyncStatus(book, job.runId);
  useAudioSyncStore.getState().setStatus(book.hash, status);
  return status;
}

export async function pollAudioAlignmentStatus(
  appService: AppService,
  book: Book,
  runId: string,
): Promise<AudioSyncStatus> {
  useAlignmentJobStore.getState().setPolling(book.hash, true);
  try {
    const currentStatus = await appService.getAudioSyncStatus(book, runId);
    if (currentStatus.job?.phase && TERMINAL_PHASES.has(currentStatus.job.phase)) {
      const terminalStatus = await ensureAudioSyncPackage(appService, book, currentStatus, runId);
      useAudioSyncStore.getState().setStatus(book.hash, terminalStatus);
      useAlignmentJobStore.getState().clearActiveRun(book.hash);
      return terminalStatus;
    }

    await new Promise<void>((resolve) => {
      let done = false;
      let unsubscribe: (() => void) | null = null;

      const finalize = () => {
        if (done) return;
        done = true;
        if (unsubscribe) {
          unsubscribe();
        }
        resolve();
      };

      void listenAudioSyncJobStatus((status) => {
        if (status.jobId !== runId) return;
        if (status.phase && TERMINAL_PHASES.has(status.phase)) {
          finalize();
        }
      })
        .then(async (unlisten) => {
          if (done) {
            unlisten();
            return;
          }
          unsubscribe = unlisten;
          const status = await appService.getAudioSyncStatus(book, runId);
          if (status.job?.phase && TERMINAL_PHASES.has(status.job.phase)) {
            finalize();
          }
        })
        .catch(() => {
          finalize();
        });
    });

    const terminalStatus = await appService.getAudioSyncStatus(book, runId);
    const nextStatus = await ensureAudioSyncPackage(appService, book, terminalStatus, runId);
    useAudioSyncStore.getState().setStatus(book.hash, nextStatus);
    if (nextStatus.job?.phase && TERMINAL_PHASES.has(nextStatus.job.phase)) {
      useAlignmentJobStore.getState().clearActiveRun(book.hash);
    }
    return nextStatus;
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
