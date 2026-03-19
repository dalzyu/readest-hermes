import React, { useEffect, useState, useCallback } from 'react';
import { PiTrash, PiDownloadSimple, PiMagnifyingGlass } from 'react-icons/pi';
import { useTranslation } from '@/hooks/useTranslation';
import { useEnv } from '@/context/EnvContext';
import { useSettingsStore } from '@/store/settingsStore';
import { DEFAULT_CONTEXT_TRANSLATION_SETTINGS } from '@/services/contextTranslation/defaults';
import type { VocabularyEntry } from '@/services/contextTranslation/types';
import {
  getVocabularyForBook,
  deleteVocabularyEntry,
  searchVocabulary,
  exportAsAnkiTSV,
  exportAsCSV,
} from '@/services/contextTranslation/vocabularyService';

interface VocabularyPanelProps {
  bookKey: string;
  bookHash: string;
}

const VocabularyPanel: React.FC<VocabularyPanelProps> = ({ bookHash }) => {
  const _ = useTranslation();
  const { appService } = useEnv();
  const { settings } = useSettingsStore();

  const ctxSettings =
    settings?.globalReadSettings?.contextTranslation ?? DEFAULT_CONTEXT_TRANSLATION_SETTINGS;

  const [entries, setEntries] = useState<VocabularyEntry[]>([]);
  const [searchQuery, setSearchQuery] = useState('');
  const [isSearching, setIsSearching] = useState(false);
  const [expandedId, setExpandedId] = useState<string | null>(null);

  const loadEntries = useCallback(() => {
    getVocabularyForBook(bookHash).then(setEntries).catch(() => setEntries([]));
  }, [bookHash]);

  useEffect(() => {
    let active = true;
    getVocabularyForBook(bookHash).then((data) => {
      if (active) setEntries(data);
    }).catch(() => {
      if (active) setEntries([]);
    });
    return () => { active = false; };
  }, [bookHash]);

  const handleSearch = async (q: string) => {
    setSearchQuery(q);
    if (!q.trim()) {
      loadEntries();
      return;
    }
    const results = await searchVocabulary(q);
    setEntries(results.filter((e) => e.bookHash === bookHash));
  };

  const handleDelete = async (id: string) => {
    await deleteVocabularyEntry(id);
    setEntries((prev: VocabularyEntry[]) => prev.filter((e) => e.id !== id));
  };

  const handleExport = async (format: 'anki' | 'csv') => {
    const content =
      format === 'anki'
        ? exportAsAnkiTSV(entries, ctxSettings.outputFields)
        : exportAsCSV(entries, ctxSettings.outputFields);
    const filename =
      format === 'anki' ? 'vocabulary-anki.txt' : 'vocabulary.csv';
    if (appService) {
      await appService.saveFile(filename, 'Downloads', content);
    } else {
      const blob = new Blob([content], { type: 'text/plain;charset=utf-8' });
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = filename;
      a.click();
      URL.revokeObjectURL(url);
    }
  };

  const enabledFields = ctxSettings.outputFields
    .filter((f) => f.enabled)
    .sort((a, b) => a.order - b.order);

  return (
    <div className='flex h-full flex-col'>
      {/* Toolbar */}
      <div className='flex items-center gap-2 border-b border-base-300/50 px-3 py-2'>
        <div className='relative flex-1'>
          <PiMagnifyingGlass
            className='absolute left-2 top-1/2 -translate-y-1/2 text-base-content/40'
            size={14}
          />
          <input
            type='text'
            className='input input-bordered input-xs w-full pl-7'
            placeholder={_('Search vocabulary...')}
            value={searchQuery}
            onChange={(e) => handleSearch(e.target.value)}
            onFocus={() => setIsSearching(true)}
            onBlur={() => setIsSearching(false)}
          />
        </div>
        <button
          className='btn btn-ghost btn-xs'
          title={_('Export as Anki TSV')}
          disabled={entries.length === 0}
          onClick={() => handleExport('anki')}
        >
          <PiDownloadSimple size={16} />
        </button>
      </div>

      {/* Entry list */}
      <div className='flex-1 overflow-y-auto px-3 py-2'>
        {entries.length === 0 && (
          <p className='mt-8 text-center text-sm text-base-content/50'>
            {isSearching || searchQuery
              ? _('No entries match your search')
              : _('No vocabulary saved yet.\nSelect text and tap the bookmark icon.')}
          </p>
        )}
        <ul className='space-y-2'>
          {entries.map((entry) => (
            <li key={entry.id}>
              <div className='collapse collapse-arrow border border-base-300 bg-base-100 rounded-lg'>
                <input
                  type='checkbox'
                  checked={expandedId === entry.id}
                  onChange={() => setExpandedId(expandedId === entry.id ? null : entry.id)}
                />
                <div className='collapse-title flex items-center justify-between pe-8 py-2 px-3 min-h-0 h-auto'>
                  <div className='min-w-0'>
                    <p className='font-medium text-sm truncate'>{entry.term}</p>
                    {entry.context && (
                      <p className='text-xs text-base-content/50 truncate mt-0.5'>
                        {entry.context.slice(0, 60)}
                        {entry.context.length > 60 ? '\u2026' : ''}
                      </p>
                    )}
                  </div>
                </div>
                <div className='collapse-content px-3 pb-3'>
                  {enabledFields.map((field) => {
                    const val = entry.result[field.id];
                    if (!val) return null;
                    return (
                      <div key={field.id} className='mt-2'>
                        <p className='text-xs font-medium uppercase tracking-wide text-base-content/50 mb-0.5'>
                          {_(field.label)}
                        </p>
                        <p className='text-sm leading-relaxed select-text'>{val}</p>
                      </div>
                    );
                  })}
                  <div className='mt-3 flex justify-between items-center'>
                    <p className='text-xs text-base-content/30'>
                      {new Date(entry.addedAt).toLocaleDateString()}
                    </p>
                    <button
                      className='btn btn-ghost btn-xs text-error'
                      onClick={() => handleDelete(entry.id)}
                      title={_('Delete')}
                    >
                      <PiTrash size={14} />
                    </button>
                  </div>
                </div>
              </div>
            </li>
          ))}
        </ul>
      </div>
    </div>
  );
};

export default VocabularyPanel;
