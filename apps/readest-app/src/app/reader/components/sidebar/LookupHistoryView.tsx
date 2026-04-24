import { useCallback, useEffect, useState } from 'react';
import { useTranslation } from '@/hooks/useTranslation';
import { useBookDataStore } from '@/store/bookDataStore';
import {
  getLookupHistoryForBook,
  type LookupHistoryEntry,
} from '@/services/contextTranslation/lookupHistoryService';
import { eventDispatcher } from '@/utils/event';
import { useLookupHistoryReplay } from '../history/LookupHistoryReplay';

function getRecentLookupPreview(entry: LookupHistoryEntry): string {
  const resultPreview = Object.keys(entry.result)
    .sort()
    .map((key) => entry.result[key]?.trim() ?? '')
    .find((value) => value.length > 0);
  const segments = [entry.context.trim(), resultPreview ?? ''].filter(
    (segment) => segment.length > 0,
  );
  const preview = segments.join(' · ');
  return preview.length > 72 ? `${preview.slice(0, 71).trimEnd()}…` : preview;
}

const LookupHistoryView: React.FC<{ bookKey: string }> = ({ bookKey }) => {
  const _ = useTranslation();
  const { getBookData } = useBookDataStore();
  const bookHash = getBookData(bookKey)?.book?.hash ?? '';
  const [entries, setEntries] = useState<LookupHistoryEntry[]>([]);
  const { handleHistoryRowClick, replayPopup } = useLookupHistoryReplay(bookKey);

  const refresh = useCallback(() => {
    if (!bookHash) return;
    setEntries(getLookupHistoryForBook(bookHash));
  }, [bookHash]);

  useEffect(() => {
    refresh();
    eventDispatcher.on('lookup-history-updated', refresh);
    return () => {
      eventDispatcher.off('lookup-history-updated', refresh);
    };
  }, [refresh]);

  if (!entries.length) {
    return (
      <>
        <div className='flex h-full items-center justify-center'>
          <p className='text-sm text-gray-400'>{_('No lookups yet')}</p>
        </div>
        {replayPopup}
      </>
    );
  }

  return (
    <>
      <div className='sidebar-scroller h-full'>
        <div className='space-y-1 p-2'>
          {entries.map((entry) => {
            const preview = getRecentLookupPreview(entry);
            const title = entry.location
              ? _(
                  'Click to replay this lookup. Shift/Ctrl/Cmd-click to jump to the saved location.',
                )
              : _('Click to replay this lookup.');

            return (
              <button
                key={entry.id}
                type='button'
                className='hover:bg-base-300/50 block w-full cursor-pointer rounded border-0 bg-transparent px-2 py-1.5 text-left transition-colors'
                onClick={(event) => {
                  handleHistoryRowClick(entry, event);
                }}
                title={title}
              >
                <div className='flex items-baseline gap-2'>
                  <span className='not-eink:text-white/90 text-sm font-medium'>{entry.term}</span>
                  <span className='text-xs text-gray-500'>
                    {entry.mode === 'dictionary' ? _('Dict') : _('Trans')}
                  </span>
                </div>
                {preview && (
                  <p className='not-eink:text-white/60 mt-0.5 truncate text-xs'>{preview}</p>
                )}
              </button>
            );
          })}
        </div>
      </div>
      {replayPopup}
    </>
  );
};

export default LookupHistoryView;
