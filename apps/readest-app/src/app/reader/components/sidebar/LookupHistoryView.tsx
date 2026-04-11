import React, { useCallback, useEffect, useState } from 'react';
import { useTranslation } from '@/hooks/useTranslation';
import { useBookDataStore } from '@/store/bookDataStore';
import {
  getLookupHistoryForBook,
  type LookupHistoryEntry,
} from '@/services/contextTranslation/lookupHistoryService';
import { eventDispatcher } from '@/utils/event';

const LookupHistoryView: React.FC<{ bookKey: string }> = ({ bookKey }) => {
  const _ = useTranslation();
  const { getBookData } = useBookDataStore();
  const bookHash = getBookData(bookKey)?.book?.hash ?? '';
  const [entries, setEntries] = useState<LookupHistoryEntry[]>([]);

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
      <div className='flex h-full items-center justify-center'>
        <p className='text-sm text-gray-400'>{_('No lookups yet')}</p>
      </div>
    );
  }

  return (
    <div className='sidebar-scroller h-full'>
      <div className='space-y-1 p-2'>
        {entries.map((entry) => {
          const translation = entry.result['translation'] ?? '';
          const shortDef = translation.length > 80 ? `${translation.slice(0, 80)}…` : translation;
          return (
            <div
              key={entry.id}
              className='hover:bg-base-300/50 rounded px-2 py-1.5 transition-colors'
            >
              <div className='flex items-baseline gap-2'>
                <span className='not-eink:text-white/90 text-sm font-medium'>{entry.term}</span>
                <span className='text-xs text-gray-500'>
                  {entry.mode === 'dictionary' ? _('Dict') : _('Trans')}
                </span>
              </div>
              {shortDef && (
                <p className='not-eink:text-white/60 mt-0.5 truncate text-xs'>{shortDef}</p>
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
};

export default LookupHistoryView;
