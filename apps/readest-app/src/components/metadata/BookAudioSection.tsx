import React from 'react';

import { BookAudioAsset, AudioSyncStatus } from '@/services/audioSync/types';
import { useTranslation } from '@/hooks/useTranslation';

interface BookAudioSectionProps {
  asset: BookAudioAsset | null;
  status: AudioSyncStatus | null;
  busy: boolean;
  isDesktop: boolean;
  onAttach?: () => void;
  onRemove?: () => void;
  onGenerateSync?: () => void;
  onViewStatus?: () => void;
}

function formatDuration(durationMs?: number): string | null {
  if (!durationMs || durationMs <= 0) return null;
  const totalSeconds = Math.floor(durationMs / 1000);
  const hours = Math.floor(totalSeconds / 3600);
  const minutes = Math.floor((totalSeconds % 3600) / 60);
  const seconds = totalSeconds % 60;
  if (hours > 0) {
    return [hours, minutes, seconds].map((value) => value.toString().padStart(2, '0')).join(':');
  }
  return [minutes, seconds].map((value) => value.toString().padStart(2, '0')).join(':');
}

function getStatusLabel(status: AudioSyncStatus | null, _: (key: string) => string): string {
  if (!status?.asset) return _('No audiobook attached');
  if (status.job) {
    return `${_('Syncing')}: ${status.job.phase}`;
  }
  if (status.synced) {
    return status.chapterFallback ? _('Chapter-level sync ready') : _('Sync ready');
  }
  if (status.syncStage === 'legacy') {
    return _('Legacy sync detected, regenerate required');
  }
  if (status.syncStage === 'intermediate') {
    return _('Sync map generated, package generation pending');
  }
  return _('Audiobook attached');
}

const BookAudioSection: React.FC<BookAudioSectionProps> = ({
  asset,
  status,
  busy,
  isDesktop,
  onAttach,
  onRemove,
  onGenerateSync,
  onViewStatus,
}) => {
  const _ = useTranslation();

  if (!isDesktop) {
    return null;
  }

  const statusLabel = getStatusLabel(status, _);

  return (
    <div className='border-base-300/60 mt-4 border-t px-4 py-4'>
      <div className='mb-3 flex items-center justify-between gap-4'>
        <div>
          <h3 className='text-neutral-content/85 text-base font-semibold'>{_('Audiobook')}</h3>
          <p className='text-neutral-content text-sm'>{statusLabel}</p>
        </div>
        <div className='flex flex-wrap justify-end gap-2'>
          <button className='btn btn-sm' disabled={busy} onClick={onAttach}>
            {asset ? _('Replace Audiobook') : _('Attach Audiobook')}
          </button>
          <button className='btn btn-sm' disabled={!asset || busy} onClick={onGenerateSync}>
            {_('Generate Sync')}
          </button>
          <button className='btn btn-sm' disabled={!asset} onClick={onViewStatus}>
            {_('View Status')}
          </button>
          <button className='btn btn-sm btn-outline' disabled={!asset || busy} onClick={onRemove}>
            {_('Remove Audiobook')}
          </button>
        </div>
      </div>

      {asset ? (
        <div className='grid grid-cols-2 gap-4 sm:grid-cols-4'>
          <div className='overflow-hidden'>
            <span className='font-bold'>{_('File')}</span>
            <p className='text-neutral-content line-clamp-1 text-sm'>{asset.originalFilename}</p>
          </div>
          <div className='overflow-hidden'>
            <span className='font-bold'>{_('Format')}</span>
            <p className='text-neutral-content text-sm'>{asset.format.toUpperCase()}</p>
          </div>
          <div className='overflow-hidden'>
            <span className='font-bold'>{_('Duration')}</span>
            <p className='text-neutral-content text-sm'>
              {formatDuration(asset.durationMs) || _('Unknown')}
            </p>
          </div>
          <div className='overflow-hidden'>
            <span className='font-bold'>{_('Chapters')}</span>
            <p className='text-neutral-content text-sm'>
              {asset.chapterCount ? asset.chapterCount : _('Unknown')}
            </p>
          </div>
        </div>
      ) : (
        <p className='text-neutral-content text-sm'>
          {_('Attach an audiobook to keep audio and text in sync for this book.')}
        </p>
      )}
    </div>
  );
};

export default BookAudioSection;
