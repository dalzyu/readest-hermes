import React from 'react';

import { AudioSyncHelperState } from '@/services/audioSync/nativeBridge';
import { BookAudioAsset, AudioSyncStatus } from '@/services/audioSync/types';
import { useTranslation } from '@/hooks/useTranslation';

export interface WhisperxModelOption {
  id: string;
  label: string;
}

/** Models ordered from fastest/smallest to most accurate/largest. */
export const WHISPERX_MODELS: WhisperxModelOption[] = [
  { id: 'base.en', label: 'Fast English — base.en (~290 MB)' },
  { id: 'base', label: 'Fast multilingual — base (~290 MB)' },
  { id: 'small.en', label: 'Balanced English — small.en (~490 MB)' },
  { id: 'small', label: 'Balanced multilingual — small (~490 MB)' },
  { id: 'medium.en', label: 'Accurate English — medium.en (~1.5 GB)' },
  { id: 'medium', label: 'Accurate multilingual — medium (~1.5 GB)' },
  { id: 'large-v3', label: 'Best quality — large-v3 (~3 GB)' },
];

export const DEFAULT_WHISPERX_MODEL = 'large-v3';

interface BookAudioSectionProps {
  asset: BookAudioAsset | null;
  status: AudioSyncStatus | null;
  busy: boolean;
  isDesktop: boolean;
  model: string;
  helperState?: AudioSyncHelperState | null;
  onAttach?: () => void;
  onRemove?: () => void;
  onGenerateSync?: () => void;
  onInstallHelper?: () => void;
  onViewStatus?: () => void;
  onModelChange?: (model: string) => void;
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
  model,
  helperState,
  onAttach,
  onRemove,
  onGenerateSync,
  onInstallHelper,
  onViewStatus,
  onModelChange,
}) => {
  const _ = useTranslation();

  if (!isDesktop) {
    return null;
  }

  const statusLabel = getStatusLabel(status, _);
  const helperReady = helperState?.state === 'ready' || helperState?.state === 'devMode';
  const requiresHelperInstall =
    helperState?.state === 'notInstalled' || helperState?.state === 'failed';

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
          <button
            className='btn btn-sm'
            disabled={!asset || busy || !helperReady}
            onClick={onGenerateSync}
          >
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

      {asset && !helperReady && requiresHelperInstall && (
        <div className='bg-base-200/60 mb-3 rounded-md px-3 py-2 text-sm'>
          <p className='text-neutral-content mb-2'>{_('Audio sync helper is not installed.')}</p>
          <button className='btn btn-sm' disabled={busy} onClick={onInstallHelper}>
            {_('Install helper')}
          </button>
        </div>
      )}
      {asset ? (
        <>
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

          {onModelChange && (
            <div className='mt-3'>
              <label className='text-neutral-content/85 mb-1 block text-xs font-semibold'>
                {_('Sync model')}
              </label>
              <select
                className='select select-bordered select-sm w-full max-w-sm text-sm'
                value={model}
                disabled={busy}
                onChange={(e) => onModelChange(e.target.value)}
              >
                {WHISPERX_MODELS.map((m) => (
                  <option key={m.id} value={m.id}>
                    {m.label}
                  </option>
                ))}
              </select>
              <p className='text-neutral-content/60 mt-1 text-xs'>
                {_('Larger models are more accurate but require more VRAM and time.')}
              </p>
            </div>
          )}
        </>
      ) : (
        <p className='text-neutral-content text-sm'>
          {_('Attach an audiobook to keep audio and text in sync for this book.')}
        </p>
      )}
    </div>
  );
};

export default BookAudioSection;
