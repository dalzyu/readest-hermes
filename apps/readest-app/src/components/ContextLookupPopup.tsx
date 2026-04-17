import React from 'react';
import { PiArrowLeft, PiArrowRight, PiInfo, PiLightbulb } from 'react-icons/pi';
import { RiBookmarkFill, RiBookmarkLine, RiVolumeUpLine } from 'react-icons/ri';

import Popup from '@/components/Popup';
import { useTranslation } from '@/hooks/useTranslation';
import type { Position } from '@/utils/sel';

export interface ContextLookupPopupProps {
  selectedText: string;
  selectedTextPinyin?: string;
  retrievalStatusMeta: {
    label: string;
    className: string;
  };
  retrievalInfoText: string;
  loading: boolean;
  aiEnabled: boolean;
  hasDisplayedResult: boolean;
  onSpeakSelectedText: () => void;
  askAboutThisEnabled: boolean;
  onAskAboutThis: () => void;
  saveEnabled: boolean;
  saved: boolean;
  onSave: () => void;
  canNavigateBack?: boolean;
  canNavigateForward?: boolean;
  onNavigateBack?: () => void;
  onNavigateForward?: () => void;
  position: Position;
  trianglePosition: Position;
  popupWidth: number;
  popupHeight: number;
  onDismiss?: () => void;
  testId?: string;
  maxWidth?: string;
  children: React.ReactNode;
}

const ContextLookupPopup: React.FC<ContextLookupPopupProps> = ({
  selectedText,
  selectedTextPinyin,
  retrievalStatusMeta,
  retrievalInfoText,
  loading,
  aiEnabled,
  hasDisplayedResult,
  onSpeakSelectedText,
  askAboutThisEnabled,
  onAskAboutThis,
  saveEnabled,
  saved,
  onSave,
  canNavigateBack,
  canNavigateForward,
  onNavigateBack,
  onNavigateForward,
  position,
  trianglePosition,
  popupWidth,
  popupHeight,
  onDismiss,
  testId,
  maxWidth,
  children,
}) => {
  const _ = useTranslation();

  return (
    <div data-testid={testId} style={maxWidth ? { maxWidth } : undefined}>
      <Popup
        trianglePosition={trianglePosition}
        width={popupWidth}
        minHeight={popupHeight}
        maxHeight={480}
        position={position}
        className='not-eink:text-white flex flex-col bg-gray-700'
        triangleClassName='text-gray-700'
        onDismiss={onDismiss}
      >
        <div className='flex items-center justify-between border-b border-gray-500/30 px-4 py-3'>
          <div className='flex min-w-0 flex-col gap-2'>
            <span className='not-eink:text-yellow-300 flex min-w-0 select-text items-center gap-2 font-medium'>
              {(canNavigateBack || canNavigateForward) && (
                <span className='flex items-center gap-1'>
                  <button
                    type='button'
                    onClick={onNavigateBack}
                    title={_('Back')}
                    aria-label={_('Back')}
                    disabled={!canNavigateBack}
                    className='flex-shrink-0 text-cyan-200/80 transition-colors hover:text-cyan-100 disabled:opacity-30'
                  >
                    <PiArrowLeft size={14} />
                  </button>
                  <button
                    type='button'
                    onClick={onNavigateForward}
                    title={_('Forward')}
                    aria-label={_('Forward')}
                    disabled={!canNavigateForward}
                    className='flex-shrink-0 text-cyan-200/80 transition-colors hover:text-cyan-100 disabled:opacity-30'
                  >
                    <PiArrowRight size={14} />
                  </button>
                </span>
              )}
              <button
                type='button'
                onClick={onSpeakSelectedText}
                title={_('Speak')}
                className='flex-shrink-0 text-green-200/70 transition-colors hover:text-green-100'
                aria-label={_('Speak')}
              >
                <RiVolumeUpLine size={16} />
              </button>
              <span className='line-clamp-1'>{selectedText}</span>
              {selectedTextPinyin ? (
                <span className='truncate text-sm font-normal text-cyan-200'>
                  {selectedTextPinyin}
                </span>
              ) : null}
            </span>
            <div className='flex items-center gap-2'>
              <span
                className={`inline-flex items-center rounded-full border px-2 py-0.5 text-[11px] font-medium ${retrievalStatusMeta.className}`}
              >
                {_(retrievalStatusMeta.label)}
              </span>
              <button
                type='button'
                title={_(retrievalInfoText)}
                className='text-gray-300 transition-colors hover:text-white'
                aria-label={_('Retrieval context info')}
              >
                <PiInfo size={14} />
              </button>
            </div>
          </div>
          <div className='flex items-center gap-2'>
            <button
              type='button'
              onClick={onAskAboutThis}
              disabled={!askAboutThisEnabled}
              className='rounded-full border border-cyan-400/40 px-3 py-1 text-xs font-medium text-cyan-200 transition-colors hover:border-cyan-300 hover:text-cyan-100 disabled:opacity-40'
            >
              {_('Ask About This')}
            </button>
            <button
              onClick={onSave}
              disabled={!saveEnabled}
              title={saved ? _('Saved') : _('Save to vocabulary')}
              className='text-gray-400 transition-colors hover:text-yellow-300 disabled:opacity-40'
            >
              {saved ? <RiBookmarkFill size={18} /> : <RiBookmarkLine size={18} />}
            </button>
          </div>
        </div>

        <div className='flex flex-1 flex-col gap-3 overflow-y-auto p-4'>
          {children}

          {!aiEnabled && !loading && !hasDisplayedResult && (
            <div className='mt-1 flex items-start gap-1.5 rounded-md border border-cyan-400/20 bg-cyan-400/10 px-3 py-2'>
              <PiLightbulb size={14} className='mt-0.5 flex-shrink-0 text-cyan-300' />
              <p className='text-xs leading-snug text-cyan-200/80'>
                {_(
                  'Enable AI Assistant in Settings for contextual meaning, usage examples, and more.',
                )}
              </p>
            </div>
          )}
        </div>
      </Popup>
    </div>
  );
};

export default ContextLookupPopup;
