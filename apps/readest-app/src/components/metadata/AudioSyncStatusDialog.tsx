import React from 'react';

import Dialog from '@/components/Dialog';
import { AudioSyncStatus } from '@/services/audioSync/types';
import { useTranslation } from '@/hooks/useTranslation';

const PHASE_LABELS: Record<string, string> = {
  pending: 'Queued',
  importing: 'Loading input',
  matching: 'Matching chapters',
  transcribing: 'Transcribing',
  aligning: 'Transcribing & aligning',
  compacting: 'Writing sync map',
  ready: 'Complete',
  failed: 'Failed',
  cancelled: 'Cancelled',
};

interface AudioSyncStatusDialogProps {
  isOpen: boolean;
  status: AudioSyncStatus | null;
  onClose: () => void;
}

const AudioSyncStatusDialog: React.FC<AudioSyncStatusDialogProps> = ({
  isOpen,
  status,
  onClose,
}) => {
  const _ = useTranslation();
  const warnings = status?.report?.warnings || [];
  const errors = status?.report?.errors || [];
  const validation = status?.package?.validation;
  const validationErrors = validation?.diagnostics.filter((d) => d.severity === 'error') || [];
  const validationWarnings = validation?.diagnostics.filter((d) => d.severity === 'warning') || [];
  const syncLabel = status?.synced
    ? status.chapterFallback
      ? _('Chapter-level sync ready')
      : _('Sentence-level sync ready')
    : status?.syncStage === 'legacy'
      ? _('Legacy sync detected, regenerate required')
      : status?.syncStage === 'intermediate'
        ? _('Sync map generated, package generation pending')
        : _('No sync map generated');

  return (
    <Dialog
      title={_('Audiobook Sync Status')}
      isOpen={isOpen}
      onClose={onClose}
      boxClassName='sm:min-w-[520px] sm:max-w-[520px]'
      contentClassName='!px-6 !py-4'
    >
      <div className='flex flex-col gap-4 text-sm'>
        <div className='grid grid-cols-2 gap-4'>
          <div>
            <span className='font-bold'>{_('Audiobook')}</span>
            <p className='text-neutral-content'>
              {status?.asset?.originalFilename || _('None attached')}
            </p>
          </div>
          <div>
            <span className='font-bold'>{_('Audio file')}</span>
            <p className='text-neutral-content'>
              {status?.playable
                ? _('Attached \u2014 sync required for highlighting')
                : _('No audiobook attached')}
            </p>
          </div>
          <div>
            <span className='font-bold'>{_('Sync')}</span>
            <p className='text-neutral-content'>{syncLabel}</p>
          </div>
          <div>
            <span className='font-bold'>{_('Job')}</span>
            <p className='text-neutral-content'>
              {status?.job ? (PHASE_LABELS[status.job.phase] ?? status.job.phase) : _('Idle')}
            </p>
          </div>
        </div>

        {status?.job && !['ready', 'failed', 'cancelled'].includes(status.job.phase) && (
          <div>
            <div className='bg-base-300 h-1.5 w-full overflow-hidden rounded-full'>
              <div
                className='bg-primary h-1.5 rounded-full transition-all duration-500'
                style={{ width: `${status.job.progress}%` }}
              />
            </div>
            {status.job.message && (
              <p className='text-neutral-content/60 mt-1 text-xs'>{status.job.message}</p>
            )}
          </div>
        )}

        {status?.job?.phase === 'failed' && (
          <div className='bg-error/10 border-error/20 rounded border p-3'>
            <p className='text-error text-xs font-semibold'>{_('Sync failed')}</p>
            <p className='text-error/80 mt-1 break-all text-xs'>
              {status.job.message ||
                status.job.error ||
                _('Unknown error — check that the audio file is accessible.')}
            </p>
          </div>
        )}

        {status?.map && (
          <div className='grid grid-cols-2 gap-4'>
            <div>
              <span className='font-bold'>{_('Granularity')}</span>
              <p className='text-neutral-content'>{status.map.granularity}</p>
            </div>
            <div>
              <span className='font-bold'>{_('Segments')}</span>
              <p className='text-neutral-content'>{status.map.segments.length}</p>
            </div>
            <div>
              <span className='font-bold'>{_('Coverage')}</span>
              <p className='text-neutral-content'>
                {Math.round((status.map.coverage.matchedRatio || 0) * 100)}%
              </p>
            </div>
            <div>
              <span className='font-bold'>{_('Confidence')}</span>
              <p className='text-neutral-content'>
                {Math.round(status.map.confidence.overall * 100)}%
              </p>
            </div>
          </div>
        )}

        {status?.package && (
          <div className='grid grid-cols-2 gap-4'>
            <div>
              <span className='font-bold'>{_('Package')}</span>
              <p className='text-neutral-content'>
                {validation?.valid ? _('Validated') : _('Invalid — regenerate required')}
              </p>
            </div>
            <div>
              <span className='font-bold'>{_('Package size')}</span>
              <p className='text-neutral-content'>
                {status.package.sizeBytes > 0
                  ? `${(status.package.sizeBytes / 1024 / 1024).toFixed(1)} MB`
                  : _('Unknown')}
              </p>
            </div>
            {status.package.report?.model && (
              <div>
                <span className='font-bold'>{_('Model')}</span>
                <p className='text-neutral-content'>{status.package.report.model}</p>
              </div>
            )}
          </div>
        )}

        {warnings.length > 0 && (
          <div>
            <span className='font-bold'>{_('Warnings')}</span>
            <ul className='text-neutral-content mt-1 list-disc ps-5'>
              {warnings.map((warning) => (
                <li key={warning}>{warning}</li>
              ))}
            </ul>
          </div>
        )}

        {errors.length > 0 && (
          <div>
            <span className='font-bold text-red-500'>{_('Errors')}</span>
            <ul className='text-neutral-content mt-1 list-disc ps-5'>
              {errors.map((error) => (
                <li key={error}>{error}</li>
              ))}
            </ul>
          </div>
        )}

        {validationErrors.length > 0 && (
          <div>
            <span className='font-bold text-red-500'>{_('Package validation errors')}</span>
            <ul className='text-neutral-content mt-1 list-disc ps-5'>
              {validationErrors.map((d) => (
                <li key={d.code}>{d.message}</li>
              ))}
            </ul>
          </div>
        )}

        {validationWarnings.length > 0 && (
          <div>
            <span className='font-bold'>{_('Package validation warnings')}</span>
            <ul className='text-neutral-content mt-1 list-disc ps-5'>
              {validationWarnings.map((d) => (
                <li key={d.code}>{d.message}</li>
              ))}
            </ul>
          </div>
        )}
      </div>
    </Dialog>
  );
};

export default AudioSyncStatusDialog;
