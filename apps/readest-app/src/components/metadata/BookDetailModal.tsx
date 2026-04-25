import clsx from 'clsx';
import React, { useEffect, useState } from 'react';

import { Book } from '@/types/book';
import { BookMetadata } from '@/libs/document';
import { AudioSyncStatus, BookAudioAsset } from '@/services/audioSync/types';
import {
  pollAudioAlignmentStatus,
  startAudioAlignment,
} from '@/services/audioSync/AudioAlignmentService';
import {
  getAudioSyncHelperStatus,
  installAudioSyncHelper,
  listenHelperInstallProgress,
  type HelperInstallEvent,
} from '@/services/audioSync/nativeBridge';
import { useEnv } from '@/context/EnvContext';
import { useThemeStore } from '@/store/themeStore';
import { useTranslation } from '@/hooks/useTranslation';
import { useFileSelector } from '@/hooks/useFileSelector';
import { AUDIOBOOK_ACCEPT_FORMATS, SUPPORTED_AUDIOBOOK_EXTS } from '@/services/audioSync/constants';
import { DEFAULT_WHISPERX_MODEL } from './BookAudioSection';
import { useMetadataEdit } from './useMetadataEdit';
import { DeleteAction } from '@/types/system';
import { eventDispatcher } from '@/utils/event';
import { isWebAppPlatform } from '@/services/environment';
import Alert from '@/components/Alert';
import Dialog from '@/components/Dialog';
import BookDetailView from './BookDetailView';
import BookDetailEdit from './BookDetailEdit';
import SourceSelector from './SourceSelector';
import AudioSyncStatusDialog from './AudioSyncStatusDialog';
import Spinner from '../Spinner';

interface BookDetailModalProps {
  book: Book;
  isOpen: boolean;
  onClose: () => void;
  handleBookDownload?: (book: Book, options?: { redownload?: boolean; queued?: boolean }) => void;
  handleBookUpload?: (book: Book) => void;
  handleBookDelete?: (book: Book) => void;
  handleBookDeleteCloudBackup?: (book: Book) => void;
  handleBookDeleteLocalCopy?: (book: Book) => void;
  handleBookMetadataUpdate?: (book: Book, updatedMetadata: BookMetadata) => void;
}

interface DeleteConfig {
  title: string;
  message: string;
  handler?: (book: Book) => void;
}

const BookDetailModal: React.FC<BookDetailModalProps> = ({
  book,
  isOpen,
  onClose,
  handleBookDownload,
  handleBookUpload,
  handleBookDelete,
  handleBookDeleteCloudBackup,
  handleBookDeleteLocalCopy,
  handleBookMetadataUpdate,
}) => {
  const _ = useTranslation();
  const { envConfig, appService } = useEnv();
  const { safeAreaInsets } = useThemeStore();
  const [activeDeleteAction, setActiveDeleteAction] = useState<DeleteAction | null>(null);
  const [isLoading, setIsLoading] = useState(false);
  const [editMode, setEditMode] = useState(false);
  const [bookMeta, setBookMeta] = useState<BookMetadata | null>(null);
  const [fileSize, setFileSize] = useState<number | null>(null);
  const [bookAudioAsset, setBookAudioAsset] = useState<BookAudioAsset | null>(null);
  const [audioSyncStatus, setAudioSyncStatus] = useState<AudioSyncStatus | null>(null);
  const [isAudioBusy, setIsAudioBusy] = useState(false);
  const [isAudioStatusDialogOpen, setIsAudioStatusDialogOpen] = useState(false);
  const [selectedModel, setSelectedModel] = useState(DEFAULT_WHISPERX_MODEL);
  const [installProgress, setInstallProgress] = useState<HelperInstallEvent | null>(null);
  const { selectFiles } = useFileSelector(appService, _);

  // Initialize metadata edit hook
  const {
    editedMeta,
    fieldSources,
    lockedFields,
    fieldErrors,
    searchLoading,
    showSourceSelection,
    availableSources,
    handleFieldChange,
    handleToggleFieldLock,
    handleLockAll,
    handleUnlockAll,
    handleAutoRetrieve,
    handleSourceSelection,
    handleCloseSourceSelection,
    resetToOriginal,
  } = useMetadataEdit(bookMeta);

  const deleteConfigs: Record<DeleteAction, DeleteConfig> = {
    both: {
      title: _('Confirm Deletion'),
      message: _('Are you sure to delete the selected book?'),
      handler: handleBookDelete,
    },
    cloud: {
      title: _('Confirm Deletion'),
      message: _('Are you sure to delete the cloud backup of the selected book?'),
      handler: handleBookDeleteCloudBackup,
    },
    local: {
      title: _('Confirm Deletion'),
      message: _('Are you sure to delete the local copy of the selected book?'),
      handler: handleBookDeleteLocalCopy,
    },
  };

  const refreshAudioSyncState = async (currentAppService = appService) => {
    if (!currentAppService?.isDesktopApp) {
      setBookAudioAsset(null);
      setAudioSyncStatus(null);
      return;
    }

    try {
      const status = await currentAppService.getAudioSyncStatus(book);
      setBookAudioAsset(status.asset);
      setAudioSyncStatus(status);
    } catch (error) {
      console.warn('Failed to load audio sync status', error);
      setBookAudioAsset(null);
      setAudioSyncStatus(null);
    }
  };

  const handleAttachAudio = async () => {
    if (!appService?.isDesktopApp) return;

    const selection = await selectFiles({
      type: 'audio',
      multiple: false,
      accept: AUDIOBOOK_ACCEPT_FORMATS,
      extensions: [...SUPPORTED_AUDIOBOOK_EXTS],
      dialogTitle: _('Select Audiobook'),
    });

    if (selection.error) {
      eventDispatcher.dispatch('toast', { type: 'error', message: selection.error });
      return;
    }

    const selected = selection.files[0];
    const input = selected?.path || selected?.file;
    if (!input) return;

    setIsAudioBusy(true);
    try {
      await appService.attachBookAudio(book, input);
      await refreshAudioSyncState(appService);
      eventDispatcher.dispatch('toast', {
        type: 'info',
        message: _('Audiobook attached successfully.'),
      });
    } catch (error) {
      eventDispatcher.dispatch('toast', {
        type: 'error',
        message: error instanceof Error ? error.message : _('Failed to attach audiobook.'),
      });
    } finally {
      setIsAudioBusy(false);
    }
  };

  const handleRemoveAudio = async () => {
    if (!appService?.isDesktopApp || !bookAudioAsset) return;

    const confirmed = await appService.ask(_('Remove the attached audiobook and sync data?'));
    if (!confirmed) return;

    setIsAudioBusy(true);
    try {
      await appService.removeBookAudio(book);
      await refreshAudioSyncState(appService);
      eventDispatcher.dispatch('toast', {
        type: 'info',
        message: _('Audiobook removed.'),
      });
    } catch (error) {
      eventDispatcher.dispatch('toast', {
        type: 'error',
        message: error instanceof Error ? error.message : _('Failed to remove audiobook.'),
      });
    } finally {
      setIsAudioBusy(false);
    }
  };

  const handleGenerateAudioSync = async () => {
    if (!appService?.isDesktopApp || !bookAudioAsset) return;

    setIsAudioBusy(true);
    try {
      // Ensure helper is installed before starting alignment.
      const helperStatus = await getAudioSyncHelperStatus();
      if (helperStatus.state.state === 'notInstalled') {
        const confirmed = window.confirm(
          _('The WhisperX audio sync helper is not installed.') +
            '\n\n' +
            _('Hermes will download it now (~2.3 GB). Continue?'),
        );
        if (!confirmed) return;

        setInstallProgress({ phase: 'fetching', progress: 0, detail: _('Contacting server…') });
        const unlisten = await listenHelperInstallProgress((evt) => setInstallProgress(evt));
        try {
          await installAudioSyncHelper();
        } finally {
          unlisten();
          setInstallProgress(null);
        }
      }

      const status = await startAudioAlignment(appService, book, { model: selectedModel });
      setBookAudioAsset(status.asset);
      setAudioSyncStatus(status);
      setIsAudioStatusDialogOpen(true);
      eventDispatcher.dispatch('toast', {
        type: 'info',
        message: _('Audiobook sync started.'),
      });
    } catch (error) {
      eventDispatcher.dispatch('toast', {
        type: 'error',
        message: error instanceof Error ? error.message : _('Failed to start audiobook sync.'),
      });
    } finally {
      setIsAudioBusy(false);
    }
  };

  useEffect(() => {
    const runId = audioSyncStatus?.job?.runId;
    const phase = audioSyncStatus?.job?.phase;
    if (
      !appService?.isDesktopApp ||
      !runId ||
      !phase ||
      ['ready', 'failed', 'cancelled'].includes(phase)
    ) {
      return;
    }

    let disposed = false;
    let timer: number | undefined;

    const pollStatus = async () => {
      try {
        const status = await pollAudioAlignmentStatus(appService, book, runId);
        if (disposed) return;
        setBookAudioAsset(status.asset);
        setAudioSyncStatus(status);
        if (
          status.job?.phase &&
          ['ready', 'failed', 'cancelled'].includes(status.job.phase) &&
          timer
        ) {
          window.clearInterval(timer);
        }
      } catch (error) {
        if (!disposed) {
          console.warn('Failed to poll audio sync status', error);
        }
      }
    };

    timer = window.setInterval(() => {
      void pollStatus();
    }, 1000);
    void pollStatus();

    return () => {
      disposed = true;
      if (timer) {
        window.clearInterval(timer);
      }
    };
  }, [appService, audioSyncStatus?.job?.phase, audioSyncStatus?.job?.runId, book]);

  useEffect(() => {
    const fetchBookDetails = async () => {
      const appService = await envConfig.getAppService();
      try {
        let details = book.metadata || null;
        if (!details && book.downloadedAt) {
          details = await appService.fetchBookDetails(book);
        }
        setBookMeta(details);
        const size = await appService.getBookFileSize(book);
        setFileSize(size);
        await refreshAudioSyncState(appService);
      } finally {
      }
    };
    fetchBookDetails();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [book]);

  const handleClose = () => {
    setBookMeta(null);
    setBookAudioAsset(null);
    setAudioSyncStatus(null);
    setEditMode(false);
    setActiveDeleteAction(null);
    setIsAudioStatusDialogOpen(false);
    onClose();
  };

  const handleEditMetadata = () => {
    setEditMode(true);
  };

  const handleCancelEdit = () => {
    resetToOriginal();
    setEditMode(false);
  };

  const handleSaveMetadata = () => {
    if (editedMeta && handleBookMetadataUpdate) {
      setBookMeta({ ...editedMeta });
      handleBookMetadataUpdate(book, editedMeta);
      setEditMode(false);
    }
  };

  const handleDeleteAction = (action: DeleteAction) => {
    setActiveDeleteAction(action);
  };

  const confirmDeleteAction = async () => {
    if (!activeDeleteAction) return;

    const config = deleteConfigs[activeDeleteAction];
    handleClose();

    if (config.handler) {
      config.handler(book);
    }
  };

  const cancelDeleteAction = () => {
    setActiveDeleteAction(null);
  };

  const handleDelete = () => handleDeleteAction('both');
  const handleDeleteCloudBackup = () => handleDeleteAction('cloud');
  const handleDeleteLocalCopy = () => handleDeleteAction('local');

  const handleRedownload = async () => {
    handleClose();
    if (handleBookDownload) {
      handleBookDownload(book, { redownload: true, queued: false });
    }
  };

  const handleReupload = async () => {
    handleClose();
    if (handleBookUpload) {
      handleBookUpload(book);
    }
  };

  const handleBookExport = async () => {
    setIsLoading(true);
    setTimeout(async () => {
      const success = await appService?.exportBook(book);
      setIsLoading(false);
      if (!isWebAppPlatform()) {
        eventDispatcher.dispatch('toast', {
          type: success ? 'info' : 'error',
          message: success ? _('Book exported successfully.') : _('Failed to export the book.'),
        });
      }
    }, 0);
  };

  const currentDeleteConfig = activeDeleteAction ? deleteConfigs[activeDeleteAction] : null;

  return (
    <>
      <div className='fixed inset-0 z-50 flex items-center justify-center'>
        <Dialog
          title={editMode ? _('Edit Metadata') : _('Book Details')}
          isOpen={isOpen}
          onClose={handleClose}
          boxClassName={clsx(
            editMode ? 'sm:min-w-[600px] sm:max-w-[600px]' : 'sm:min-w-[480px] sm:max-w-[480px]',
            'sm:h-auto sm:max-h-[90%]',
          )}
          contentClassName='!px-6 !py-4'
        >
          <div className='relative flex w-full select-text items-start justify-center'>
            {editMode && bookMeta ? (
              <BookDetailEdit
                book={book}
                metadata={editedMeta}
                fieldSources={fieldSources}
                lockedFields={lockedFields}
                fieldErrors={fieldErrors}
                searchLoading={searchLoading}
                onFieldChange={handleFieldChange}
                onToggleFieldLock={handleToggleFieldLock}
                onAutoRetrieve={handleAutoRetrieve}
                onLockAll={handleLockAll}
                onUnlockAll={handleUnlockAll}
                onCancel={handleCancelEdit}
                onReset={resetToOriginal}
                onSave={handleSaveMetadata}
              />
            ) : (
              <BookDetailView
                book={book}
                metadata={bookMeta}
                fileSize={fileSize}
                onEdit={handleBookMetadataUpdate ? handleEditMetadata : undefined}
                onDelete={handleBookDelete ? handleDelete : undefined}
                onDeleteCloudBackup={
                  handleBookDeleteCloudBackup ? handleDeleteCloudBackup : undefined
                }
                onDeleteLocalCopy={handleBookDeleteLocalCopy ? handleDeleteLocalCopy : undefined}
                onDownload={handleBookDownload ? handleRedownload : undefined}
                onUpload={handleBookUpload ? handleReupload : undefined}
                onExport={handleBookExport}
                audioAsset={bookAudioAsset}
                audioSyncStatus={audioSyncStatus}
                audioBusy={isAudioBusy}
                audioModel={selectedModel}
                onAttachAudio={handleAttachAudio}
                onRemoveAudio={handleRemoveAudio}
                onGenerateAudioSync={handleGenerateAudioSync}
                onViewAudioSyncStatus={() => setIsAudioStatusDialogOpen(true)}
                onAudioModelChange={setSelectedModel}
              />
            )}
          </div>
          {installProgress && (
            <div className='bg-base-100/95 absolute inset-0 z-10 flex flex-col items-center justify-center gap-4 rounded-lg p-8'>
              <p className='text-neutral-content text-sm font-semibold'>
                {_('Installing Audio Sync Helper')}
              </p>
              <div className='w-full max-w-sm'>
                <div className='bg-base-300 h-2 w-full overflow-hidden rounded-full'>
                  <div
                    className='bg-primary h-2 rounded-full transition-all duration-300'
                    style={{ width: `${Math.round(installProgress.progress * 100)}%` }}
                  />
                </div>
                <div className='mt-2 flex justify-between text-xs'>
                  <span className='text-neutral-content/70 capitalize'>
                    {installProgress.phase}
                  </span>
                  <span className='text-neutral-content/70'>
                    {Math.round(installProgress.progress * 100)}%
                  </span>
                </div>
              </div>
              <p className='text-neutral-content/60 text-xs'>{installProgress.detail}</p>
            </div>
          )}
        </Dialog>

        <AudioSyncStatusDialog
          isOpen={isAudioStatusDialogOpen}
          status={audioSyncStatus}
          onClose={() => setIsAudioStatusDialogOpen(false)}
        />

        {/* Source Selection Modal */}
        {showSourceSelection && (
          <SourceSelector
            sources={availableSources}
            isOpen={showSourceSelection}
            onSelect={handleSourceSelection}
            onClose={handleCloseSourceSelection}
          />
        )}

        {isLoading && (
          <div className='fixed inset-0 z-50 flex items-center justify-center'>
            <Spinner loading />
          </div>
        )}

        {activeDeleteAction && currentDeleteConfig && (
          <div
            className={clsx('fixed bottom-0 left-0 right-0 z-50 flex justify-center')}
            style={{
              paddingBottom: `${(safeAreaInsets?.bottom || 0) + 16}px`,
            }}
          >
            <Alert
              title={currentDeleteConfig.title}
              message={currentDeleteConfig.message}
              onCancel={cancelDeleteAction}
              onConfirm={confirmDeleteAction}
            />
          </div>
        )}
      </div>
    </>
  );
};

export default BookDetailModal;
