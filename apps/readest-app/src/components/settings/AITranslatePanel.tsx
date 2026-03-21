import clsx from 'clsx';
import React, { useCallback, useEffect, useRef, useState } from 'react';
import { PiSpinner, PiTrash, PiWarningCircle } from 'react-icons/pi';

import { useTranslation } from '@/hooks/useTranslation';
import { useSettingsStore } from '@/store/settingsStore';
import { useEnv } from '@/context/EnvContext';
import {
  BUNDLED_DICTIONARIES,
  initBundledDictionaries,
  previewDictionaryZip,
  importUserDictionary,
  deleteUserDictionary,
} from '@/services/contextTranslation/dictionaryService';
import { getTranslatorLanguageOptions } from '@/services/translatorLanguages';
import type {
  ContextDictionarySettings,
  ContextTranslationSettings,
  UserDictionary,
} from '@/services/contextTranslation/types';
import {
  DEFAULT_CONTEXT_DICTIONARY_SETTINGS,
  DEFAULT_CONTEXT_TRANSLATION_SETTINGS,
} from '@/services/contextTranslation/defaults';

const DEFAULT_BY_ID: Record<string, string> = Object.fromEntries(
  DEFAULT_CONTEXT_TRANSLATION_SETTINGS.outputFields.map((f) => [f.id, f.promptInstruction]),
);

type TranslationSource = 'ai' | 'dictionary' | 'azure' | 'deepl' | 'google' | 'yandex';

const AITranslatePanel: React.FC = () => {
  const _ = useTranslation();
  const { envConfig } = useEnv();
  const { settings, setSettings, saveSettings } = useSettingsStore();

  const aiEnabled = settings?.aiSettings?.enabled ?? false;
  const disabledSection = !aiEnabled ? 'opacity-50 pointer-events-none select-none' : '';

  const ctxTransSettings: ContextTranslationSettings =
    settings?.globalReadSettings?.contextTranslation ?? DEFAULT_CONTEXT_TRANSLATION_SETTINGS;

  const ctxDictSettings: ContextDictionarySettings =
    settings?.globalReadSettings?.contextDictionary ?? DEFAULT_CONTEXT_DICTIONARY_SETTINGS;

  const [ctxEnabled, setCtxEnabled] = useState(ctxTransSettings.enabled);
  const [ctxTargetLang, setCtxTargetLang] = useState(ctxTransSettings.targetLanguage);
  const [ctxRecentPages, setCtxRecentPages] = useState(ctxTransSettings.recentContextPages);
  const [ctxLookAheadWords, setCtxLookAheadWords] = useState(ctxTransSettings.lookAheadWords);
  const [ctxSameBookRagEnabled, setCtxSameBookRagEnabled] = useState(
    ctxTransSettings.sameBookRagEnabled,
  );
  const [ctxPriorVolumeRagEnabled, setCtxPriorVolumeRagEnabled] = useState(
    ctxTransSettings.priorVolumeRagEnabled,
  );
  const [ctxSameBookChunkCount, setCtxSameBookChunkCount] = useState(
    ctxTransSettings.sameBookChunkCount,
  );
  const [ctxPriorVolumeChunkCount, setCtxPriorVolumeChunkCount] = useState(
    ctxTransSettings.priorVolumeChunkCount,
  );
  const [ctxOutputFields, setCtxOutputFields] = useState(ctxTransSettings.outputFields);
  const [ctxSource, setCtxSource] = useState<TranslationSource>(ctxTransSettings.source ?? 'ai');

  const [ctxDictEnabled, setCtxDictEnabled] = useState(ctxDictSettings.enabled);
  const [ctxDictSourceExamples, setCtxDictSourceExamples] = useState(
    ctxDictSettings.sourceExamples,
  );

  // Dictionaries section state
  const [dictionaryUnavailableBanner, setDictionaryUnavailableBanner] = useState(false);
  const [userDictionaries, setUserDictionaries] = useState<UserDictionary[]>(
    settings?.userDictionaryMeta ?? [],
  );
  const [showModal, setShowModal] = useState(false);
  const [importPreview, setImportPreview] = useState<{ name: string; wordcount: number } | null>(
    null,
  );
  const [selectedZipFile, setSelectedZipFile] = useState<File | null>(null);
  const [importing, setImporting] = useState(false);
  const [importError, setImportError] = useState<string | null>(null);
  const [importSourceLang, setImportSourceLang] = useState('');
  const [importTargetLang, setImportTargetLang] = useState('');
  const fileInputRef = useRef<HTMLInputElement>(null);

  const settingsRef = useRef(settings);
  useEffect(() => {
    settingsRef.current = settings;
  }, [settings]);

  const saveCtxTransSetting = useCallback(
    (patch: Partial<ContextTranslationSettings>) => {
      const currentSettings = settingsRef.current;
      if (!currentSettings) return;
      const current: ContextTranslationSettings =
        currentSettings.globalReadSettings.contextTranslation ??
        DEFAULT_CONTEXT_TRANSLATION_SETTINGS;
      currentSettings.globalReadSettings.contextTranslation = { ...current, ...patch };
      setSettings(currentSettings);
      saveSettings(envConfig, currentSettings);
    },
    [envConfig, setSettings, saveSettings],
  );

  const saveCtxDictSetting = useCallback(
    (patch: Partial<ContextDictionarySettings>) => {
      const currentSettings = settingsRef.current;
      if (!currentSettings) return;
      const current: ContextDictionarySettings =
        currentSettings.globalReadSettings.contextDictionary ?? DEFAULT_CONTEXT_DICTIONARY_SETTINGS;
      currentSettings.globalReadSettings.contextDictionary = { ...current, ...patch };
      setSettings(currentSettings);
      saveSettings(envConfig, currentSettings);
    },
    [envConfig, setSettings, saveSettings],
  );

  const updateSource = useCallback(
    (source: TranslationSource) => {
      setCtxSource(source);
      saveCtxTransSetting({ source });
    },
    [saveCtxTransSetting],
  );

  const updatePrompt = useCallback(
    (fieldId: string, instruction: string) => {
      const updated = ctxOutputFields.map((f) =>
        f.id === fieldId ? { ...f, promptInstruction: instruction } : f,
      );
      setCtxOutputFields(updated);
      saveCtxTransSetting({ outputFields: updated });
    },
    [ctxOutputFields, saveCtxTransSetting],
  );

  const resetToDefault = useCallback(
    (fieldId: string) => {
      const defaultInstruction = DEFAULT_BY_ID[fieldId] ?? '';
      updatePrompt(fieldId, defaultInstruction);
    },
    [updatePrompt],
  );

  // Initialize bundled dictionaries on mount
  useEffect(() => {
    initBundledDictionaries().catch(() => {
      setDictionaryUnavailableBanner(true);
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Sync userDictionaries from settings
  useEffect(() => {
    setUserDictionaries(settings?.userDictionaryMeta ?? []);
  }, [settings?.userDictionaryMeta]);

  // Language code to display name helper
  const getLanguageName = (code: string): string => {
    const options = getTranslatorLanguageOptions();
    const found = options.find((o) => o.value === code);
    return found ? found.label : code.toUpperCase();
  };

  // File picker for web (native input)
  const handleAddDictionaryClick = () => {
    fileInputRef.current?.click();
  };

  const handleFileChange = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;

    setImportError(null);
    try {
      const preview = await previewDictionaryZip(file);
      setSelectedZipFile(file);
      setImportPreview({ name: preview.name, wordcount: preview.wordcount });
      setImportSourceLang('');
      setImportTargetLang('');
      setShowModal(true);
    } catch (err) {
      setImportError(_('Failed to read dictionary file'));
    } finally {
      // Reset input value so same file can be selected again
      e.target.value = '';
    }
  };

  const handleImportConfirm = async () => {
    if (!importPreview || !selectedZipFile || !importSourceLang) return;

    setImporting(true);
    setImportError(null);
    try {
      const targetLang = importTargetLang || importSourceLang;
      await importUserDictionary(selectedZipFile, {
        name: importPreview.name,
        language: importSourceLang,
        targetLanguage: targetLang,
      });
      // Refresh user dictionaries list
      setUserDictionaries(useSettingsStore.getState().settings.userDictionaryMeta ?? []);
      setShowModal(false);
      setImportPreview(null);
      setSelectedZipFile(null);
    } catch (err) {
      setImportError((err as Error).message || _('Failed to import dictionary'));
    } finally {
      setImporting(false);
    }
  };

  const handleDeleteDictionary = async (id: string) => {
    try {
      await deleteUserDictionary(id);
      setUserDictionaries((prev) => prev.filter((d) => d.id !== id));
    } catch (err) {
      console.error('Failed to delete dictionary:', err);
    }
  };

  const toggleBundledDict = useCallback(
    (id: string) => {
      const currentSettings = settingsRef.current;
      if (!currentSettings) return;
      const current: ContextTranslationSettings =
        currentSettings.globalReadSettings.contextTranslation ??
        DEFAULT_CONTEXT_TRANSLATION_SETTINGS;
      const disabled = current.disabledBundledDicts ?? [];
      const isCurrentlyDisabled = disabled.includes(id);
      const disabledBundledDicts = isCurrentlyDisabled
        ? disabled.filter((d) => d !== id)
        : [...disabled, id];
      saveCtxTransSetting({ disabledBundledDicts });
    },
    [saveCtxTransSetting],
  );

  const toggleUserDict = useCallback(
    (id: string) => {
      const currentSettings = settingsRef.current;
      if (!currentSettings) return;
      const updated = userDictionaries.map((d) =>
        d.id === id ? { ...d, enabled: !(d.enabled ?? true) } : d,
      );
      currentSettings.userDictionaryMeta = updated;
      setSettings(currentSettings);
      saveSettings(envConfig, currentSettings);
      setUserDictionaries(updated);
    },
    [userDictionaries, envConfig, setSettings, saveSettings],
  );

  return (
    <div className='my-4 w-full space-y-6'>
      {/* Hidden file input for web dictionary import */}
      <input
        ref={fileInputRef}
        type='file'
        accept='.zip'
        style={{ display: 'none' }}
        onChange={handleFileChange}
      />

      <div className={clsx('w-full', disabledSection)}>
        <h2 className='mb-2 font-medium'>{_('Context-Aware Translation')}</h2>
        <p className='text-base-content/70 mb-3 text-sm'>
          {_(
            'When enabled, selecting text in the reader sends surrounding page context to the AI model for a richer, context-aware translation.',
          )}
        </p>
        <div className='card border-base-200 bg-base-100 border shadow'>
          <div className='divide-base-200 divide-y'>
            <div className='config-item'>
              <span>{_('Enable Context-Aware Translation')}</span>
              <input
                type='checkbox'
                className='toggle'
                checked={ctxEnabled}
                onChange={() => {
                  const next = !ctxEnabled;
                  setCtxEnabled(next);
                  saveCtxTransSetting({ enabled: next });
                }}
              />
            </div>

            <div
              className={clsx(
                'config-item',
                !ctxEnabled && 'pointer-events-none select-none opacity-50',
              )}
            >
              <span>{_('Translation Source')}</span>
              <select
                data-testid='translation-source'
                className='select select-bordered select-sm'
                value={ctxSource}
                onChange={(e) => updateSource(e.target.value as TranslationSource)}
              >
                <option value='ai' disabled={!aiEnabled}>{_('AI')}</option>
                <option value='dictionary'>{_('Dictionary')}</option>
                <option value='azure'>{_('Azure')}</option>
                <option value='deepl'>{_('DeepL')}</option>
                <option value='google'>{_('Google')}</option>
                <option value='yandex'>{_('Yandex')}</option>
              </select>
            </div>

            <div
              className={clsx(
                'config-item !h-auto flex-col !items-start gap-2 py-3',
                !ctxEnabled && 'pointer-events-none select-none opacity-50',
              )}
            >
              <span>{_('Target Language')}</span>
              <select
                className='select select-bordered select-sm bg-base-100 text-base-content w-full'
                value={ctxTargetLang}
                disabled={!ctxEnabled}
                onChange={(e) => {
                  setCtxTargetLang(e.target.value);
                  saveCtxTransSetting({ targetLanguage: e.target.value });
                }}
              >
                {getTranslatorLanguageOptions().map((option) => (
                  <option key={option.value} value={option.value}>
                    {option.label}
                  </option>
                ))}
              </select>
            </div>

            <div
              className={clsx(
                'config-item',
                !ctxEnabled && 'pointer-events-none select-none opacity-50',
              )}
            >
              <span>{_('Recent Context Pages')}</span>
              <input
                type='number'
                className='input input-bordered input-sm w-20 text-right'
                min={1}
                max={20}
                value={ctxRecentPages}
                disabled={!ctxEnabled}
                onChange={(e) => {
                  const val = Math.max(1, Math.min(20, parseInt(e.target.value, 10) || 1));
                  setCtxRecentPages(val);
                  saveCtxTransSetting({ recentContextPages: val });
                }}
              />
            </div>

            <div
              className={clsx(
                'config-item',
                !ctxEnabled && 'pointer-events-none select-none opacity-50',
              )}
            >
              <span>{_('Look-ahead Words')}</span>
              <input
                type='number'
                className='input input-bordered input-sm w-20 text-right'
                min={0}
                max={300}
                value={ctxLookAheadWords}
                disabled={!ctxEnabled}
                onChange={(e) => {
                  const val = Math.max(0, Math.min(300, parseInt(e.target.value, 10) || 0));
                  setCtxLookAheadWords(val);
                  saveCtxTransSetting({ lookAheadWords: val });
                }}
              />
            </div>

            <div
              className={clsx(
                'config-item',
                !ctxEnabled && 'pointer-events-none select-none opacity-50',
              )}
            >
              <label className='flex items-center gap-2' htmlFor='ctx-same-book-memory-toggle'>
                <span>{_('Use same-book memory')}</span>
              </label>
              <input
                id='ctx-same-book-memory-toggle'
                type='checkbox'
                className='toggle'
                checked={ctxSameBookRagEnabled}
                disabled={!ctxEnabled}
                onChange={() => {
                  const next = !ctxSameBookRagEnabled;
                  setCtxSameBookRagEnabled(next);
                  saveCtxTransSetting({ sameBookRagEnabled: next });
                }}
              />
            </div>

            <div
              className={clsx(
                'config-item',
                !ctxEnabled && 'pointer-events-none select-none opacity-50',
              )}
            >
              <span>{_('Same-book memory chunks')}</span>
              <input
                type='number'
                className='input input-bordered input-sm w-20 text-right'
                min={1}
                max={10}
                value={ctxSameBookChunkCount}
                disabled={!ctxEnabled || !ctxSameBookRagEnabled}
                onChange={(e) => {
                  const val = Math.max(1, Math.min(10, parseInt(e.target.value, 10) || 1));
                  setCtxSameBookChunkCount(val);
                  saveCtxTransSetting({ sameBookChunkCount: val });
                }}
              />
            </div>

            <div
              className={clsx(
                'config-item',
                !ctxEnabled && 'pointer-events-none select-none opacity-50',
              )}
            >
              <label className='flex items-center gap-2' htmlFor='ctx-prior-volume-memory-toggle'>
                <span>{_('Use prior-volume memory')}</span>
              </label>
              <input
                id='ctx-prior-volume-memory-toggle'
                type='checkbox'
                className='toggle'
                checked={ctxPriorVolumeRagEnabled}
                disabled={!ctxEnabled}
                onChange={() => {
                  const next = !ctxPriorVolumeRagEnabled;
                  setCtxPriorVolumeRagEnabled(next);
                  saveCtxTransSetting({ priorVolumeRagEnabled: next });
                }}
              />
            </div>

            <div
              className={clsx(
                'config-item',
                !ctxEnabled && 'pointer-events-none select-none opacity-50',
              )}
            >
              <span>{_('Prior-volume memory chunks')}</span>
              <input
                type='number'
                className='input input-bordered input-sm w-20 text-right'
                min={1}
                max={10}
                value={ctxPriorVolumeChunkCount}
                disabled={!ctxEnabled || !ctxPriorVolumeRagEnabled}
                onChange={(e) => {
                  const val = Math.max(1, Math.min(10, parseInt(e.target.value, 10) || 1));
                  setCtxPriorVolumeChunkCount(val);
                  saveCtxTransSetting({ priorVolumeChunkCount: val });
                }}
              />
            </div>

            <div className={clsx(!ctxEnabled && 'pointer-events-none select-none opacity-50')}>
              <div className='px-4 py-2 text-sm font-medium'>{_('Output Fields')}</div>
              {ctxOutputFields
                .slice()
                .sort((a, b) => a.order - b.order)
                .map((field) => (
                  <div key={field.id} className='border-base-200 border-t px-4 py-2'>
                    <div className='config-item !px-0'>
                      <span className='text-sm'>{_(field.label)}</span>
                      <input
                        type='checkbox'
                        className='toggle toggle-sm'
                        checked={field.enabled}
                        disabled={!ctxEnabled || field.id === 'translation'}
                        onChange={() => {
                          if (field.id === 'translation') return;
                          const updated = ctxOutputFields.map((f) =>
                            f.id === field.id ? { ...f, enabled: !f.enabled } : f,
                          );
                          setCtxOutputFields(updated);
                          saveCtxTransSetting({ outputFields: updated });
                        }}
                      />
                    </div>
                    <details>
                      <summary
                        data-testid={`advanced-${field.id}-summary`}
                        className='cursor-pointer text-sm text-base-content/60'
                      >
                        {_('Advanced')}
                      </summary>
                      <div className='space-y-2 pl-4 pt-2'>
                        <label className='text-sm'>{_('Prompt instruction:')}</label>
                        <textarea
                          data-testid={`prompt-textarea-${field.id}`}
                          className='textarea textarea-bordered w-full text-sm'
                          rows={3}
                          value={field.promptInstruction}
                          onChange={(e) => updatePrompt(field.id, e.target.value)}
                        />
                        <button
                          data-testid={`reset-prompt-${field.id}`}
                          className='btn btn-ghost btn-sm'
                          onClick={() => resetToDefault(field.id)}
                        >
                          {_('Reset to defaults')}
                        </button>
                      </div>
                    </details>
                  </div>
                ))}
            </div>
          </div>
        </div>
      </div>

      <div className={clsx('w-full', disabledSection)}>
        <h2 className='mb-2 font-medium'>{_('Dictionary Lookup')}</h2>
        <p className='text-base-content/70 mb-3 text-sm'>
          {_(
            'When enabled, selecting text in the reader can trigger a context-aware dictionary lookup using the AI model.',
          )}
        </p>
        <div className='card border-base-200 bg-base-100 border shadow'>
          <div className='divide-base-200 divide-y'>
            <div className='config-item'>
              <label htmlFor='ctx-dict-enabled-toggle'>{_('Enable Dictionary Lookup')}</label>
              <input
                id='ctx-dict-enabled-toggle'
                type='checkbox'
                className='toggle'
                checked={ctxDictEnabled}
                onChange={() => {
                  const next = !ctxDictEnabled;
                  setCtxDictEnabled(next);
                  saveCtxDictSetting({ enabled: next });
                }}
              />
            </div>
            <div className='config-item'>
              <label htmlFor='ctx-dict-source-examples-toggle'>
                {_('Include Source Examples')}
              </label>
              <input
                id='ctx-dict-source-examples-toggle'
                type='checkbox'
                className='toggle'
                checked={ctxDictSourceExamples}
                onChange={() => {
                  const next = !ctxDictSourceExamples;
                  setCtxDictSourceExamples(next);
                  saveCtxDictSetting({ sourceExamples: next });
                }}
              />
            </div>
          </div>
        </div>
      </div>

      <div className={clsx('w-full', disabledSection)}>
        <h2 className='mb-2 font-medium'>{_('Dictionaries')}</h2>

        {dictionaryUnavailableBanner && (
          <div className='alert alert-warning mb-3'>
            <PiWarningCircle className='size-5' />
            <span>{_('Some bundled dictionaries are not available')}</span>
            <button
              className='btn btn-ghost btn-xs'
              onClick={() => setDictionaryUnavailableBanner(false)}
            >
              {_('Dismiss')}
            </button>
          </div>
        )}

        <div className='card border-base-200 bg-base-100 border shadow'>
          {/* Bundled Dictionaries sub-section */}
          <div className='border-base-200 border-b px-4 py-3'>
            <h3 className='mb-2 text-sm font-medium'>{_('Bundled Dictionaries')}</h3>
            <div className='space-y-1'>
              {BUNDLED_DICTIONARIES.map((dict) => {
                const disabledBundledDicts = ctxTransSettings.disabledBundledDicts ?? [];
                const isEnabled = !disabledBundledDicts.includes(dict.id);
                return (
                  <div key={dict.id} className='flex items-center justify-between text-sm'>
                    <span>
                      {getLanguageName(dict.language)} → {getLanguageName(dict.targetLanguage)}
                    </span>
                    <div className='flex items-center gap-2'>
                      <span className='text-base-content/60'>
                        {dict.language.toUpperCase()} → {dict.targetLanguage.toUpperCase()} ·{' '}
                        <span className='text-success'>✓ {_('ready')}</span>
                      </span>
                      <input
                        type='checkbox'
                        data-testid={`bundled-dict-toggle-${dict.id}`}
                        className='toggle toggle-sm'
                        checked={isEnabled}
                        onChange={() => toggleBundledDict(dict.id)}
                      />
                    </div>
                  </div>
                );
              })}
            </div>
          </div>

          {/* User Dictionaries sub-section */}
          <div className='px-4 py-3'>
            <div className='mb-2 flex items-center justify-between'>
              <h3 className='text-sm font-medium'>{_('User Dictionaries')}</h3>
              <button className='btn btn-outline btn-xs' onClick={handleAddDictionaryClick}>
                {_('Add Dictionary')}
              </button>
            </div>

            {userDictionaries.length === 0 ? (
              <p className='text-base-content/50 text-sm'>{_('No user dictionaries imported')}</p>
            ) : (
              <div className='space-y-1'>
                {userDictionaries.map((dict) => (
                  <div key={dict.id} className='flex items-center justify-between text-sm'>
                    <span>
                      {dict.name} · {getLanguageName(dict.language)} →{' '}
                      {getLanguageName(dict.targetLanguage)} · {dict.entryCount} entries
                    </span>
                    <div className='flex items-center gap-2'>
                      <input
                        type='checkbox'
                        data-testid={`user-dict-toggle-${dict.id}`}
                        className='toggle toggle-sm'
                        checked={dict.enabled !== false}
                        onChange={() => toggleUserDict(dict.id)}
                      />
                      <button
                        className='btn btn-ghost btn-xs text-error'
                        onClick={() => handleDeleteDictionary(dict.id)}
                        title={_('Delete dictionary')}
                      >
                        <PiTrash className='size-3' />
                      </button>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>
        </div>
      </div>

      {/* Import Modal */}
      {showModal && importPreview && (
        <div className='modal modal-open'>
          <div className='modal-box'>
            <h3 className='mb-4 font-bold'>{_('Import Dictionary')}</h3>

            <div className='space-y-4'>
              <div>
                <label className='mb-1 block text-sm'>{_('Name')}</label>
                <input
                  type='text'
                  className='input input-bordered input-sm w-full'
                  value={importPreview.name}
                  readOnly
                />
              </div>

              <div>
                <label className='mb-1 block text-sm'>{_('Source Language')}</label>
                <select
                  className='select select-bordered select-sm w-full'
                  value={importSourceLang}
                  onChange={(e) => setImportSourceLang(e.target.value)}
                >
                  <option value=''>{_('Select source language')}</option>
                  {getTranslatorLanguageOptions().map((opt) => (
                    <option key={opt.value} value={opt.value}>
                      {opt.label}
                    </option>
                  ))}
                </select>
              </div>

              <div>
                <label className='mb-1 block text-sm'>{_('Target Language')}</label>
                <select
                  className='select select-bordered select-sm w-full'
                  value={importTargetLang}
                  onChange={(e) => setImportTargetLang(e.target.value)}
                >
                  <option value=''>{_('Same as source')}</option>
                  {getTranslatorLanguageOptions().map((opt) => (
                    <option key={opt.value} value={opt.value}>
                      {opt.label}
                    </option>
                  ))}
                </select>
              </div>

              <div className='text-base-content/70 text-sm'>
                {importPreview.wordcount.toLocaleString()} entries
              </div>

              {importError && <div className='text-error text-sm'>{importError}</div>}
            </div>

            <div className='modal-action'>
              <button
                className='btn btn-ghost'
                onClick={() => {
                  setShowModal(false);
                  setImportPreview(null);
                  setImportError(null);
                }}
                disabled={importing}
              >
                {_('Cancel')}
              </button>
              <button
                className='btn btn-primary'
                onClick={handleImportConfirm}
                disabled={!selectedZipFile || !importSourceLang || importing}
              >
                {importing ? <PiSpinner className='size-4 animate-spin' /> : _('Import')}
              </button>
            </div>
          </div>
          <div className='modal-backdrop' onClick={() => setShowModal(false)} />
        </div>
      )}
    </div>
  );
};

export default AITranslatePanel;