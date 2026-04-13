import clsx from 'clsx';
import React, { useCallback, useEffect, useRef, useState } from 'react';
import { PiSpinner, PiTrash, PiWarningCircle } from 'react-icons/pi';

import { useTranslation } from '@/hooks/useTranslation';
import { useSettingsStore } from '@/store/settingsStore';
import { useEnv } from '@/context/EnvContext';
import { useAuth } from '@/context/AuthContext';
import {
  BUNDLED_DICTIONARIES,
  previewDictionaryZip,
  importUserDictionary,
  deleteUserDictionary,
} from '@/services/contextTranslation/dictionaryService';
import { getTranslatorLanguageOptions } from '@/services/translatorLanguages';
import type {
  ContextDictionarySettings,
  ContextTranslationHarnessSettings,
  ContextTranslationSettings,
  UserDictionary,
} from '@/services/contextTranslation/types';
import {
  CONTEXT_TRANSLATION_HARNESS_PRESETS,
  DEFAULT_CONTEXT_DICTIONARY_SETTINGS,
  DEFAULT_CONTEXT_TRANSLATION_HARNESS_SETTINGS,
  DEFAULT_CONTEXT_TRANSLATION_SETTINGS,
  resolveContextTranslationHarnessSettings,
} from '@/services/contextTranslation/defaults';

const DEFAULT_BY_ID: Record<string, string> = Object.fromEntries(
  DEFAULT_CONTEXT_TRANSLATION_SETTINGS.outputFields.map((f) => [f.id, f.promptInstruction]),
);

type TranslationSource = 'ai' | 'dictionary' | 'azure' | 'deepl' | 'google' | 'yandex';
type HarnessPresetId = keyof typeof CONTEXT_TRANSLATION_HARNESS_PRESETS;

function formatHarnessJson(harness: ContextTranslationHarnessSettings): string {
  return JSON.stringify(harness, null, 2);
}

const AITranslatePanel: React.FC = () => {
  const _ = useTranslation();
  const { envConfig } = useEnv();
  const { token } = useAuth();
  const { settings, setSettings, saveSettings } = useSettingsStore();

  const aiEnabled = settings?.aiSettings?.enabled ?? false;

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
  const [ctxFieldStrategy, setCtxFieldStrategy] = useState<'single' | 'multi'>(
    ctxTransSettings.fieldStrategy ?? 'single',
  );
  const [ctxAutoExpand, setCtxAutoExpand] = useState(
    ctxTransSettings.autoExpandSelection !== false,
  );
  const [ctxHarness, setCtxHarness] = useState<ContextTranslationHarnessSettings>(
    resolveContextTranslationHarnessSettings(ctxTransSettings.harness),
  );
  const [ctxHarnessDraft, setCtxHarnessDraft] = useState(
    formatHarnessJson(resolveContextTranslationHarnessSettings(ctxTransSettings.harness)),
  );
  const [ctxHarnessError, setCtxHarnessError] = useState<string | null>(null);
  const [ctxHarnessPreset, setCtxHarnessPreset] = useState<HarnessPresetId>('balanced');

  const [ctxDictEnabled, setCtxDictEnabled] = useState(ctxDictSettings.enabled);
  const [ctxDictSourceExamples, setCtxDictSourceExamples] = useState(
    ctxDictSettings.sourceExamples,
  );
  const [ctxDictSource, setCtxDictSource] = useState<'ai' | 'dictionary'>(
    ctxDictSettings.source ?? 'ai',
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

  useEffect(() => {
    const resolvedHarness = resolveContextTranslationHarnessSettings(ctxTransSettings.harness);
    setCtxHarness(resolvedHarness);
    setCtxHarnessDraft(formatHarnessJson(resolvedHarness));
    setCtxHarnessError(null);
  }, [ctxTransSettings.harness]);

  const saveCtxTransSetting = useCallback(
    (patch: Partial<ContextTranslationSettings>) => {
      const currentSettings = settingsRef.current;
      if (!currentSettings) return;
      const current: ContextTranslationSettings =
        currentSettings.globalReadSettings.contextTranslation ??
        DEFAULT_CONTEXT_TRANSLATION_SETTINGS;
      const newSettings = {
        ...currentSettings,
        globalReadSettings: {
          ...currentSettings.globalReadSettings,
          contextTranslation: { ...current, ...patch },
        },
      };
      setSettings(newSettings);
      saveSettings(envConfig, newSettings).catch(console.error);
    },
    [envConfig, setSettings, saveSettings],
  );

  const saveCtxDictSetting = useCallback(
    (patch: Partial<ContextDictionarySettings>) => {
      const currentSettings = settingsRef.current;
      if (!currentSettings) return;
      const current: ContextDictionarySettings =
        currentSettings.globalReadSettings.contextDictionary ?? DEFAULT_CONTEXT_DICTIONARY_SETTINGS;
      const newSettings = {
        ...currentSettings,
        globalReadSettings: {
          ...currentSettings.globalReadSettings,
          contextDictionary: { ...current, ...patch },
        },
      };
      setSettings(newSettings);
      saveSettings(envConfig, newSettings).catch(console.error);
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

  const saveCtxHarness = useCallback(
    (patch: Partial<ContextTranslationHarnessSettings>) => {
      const next = resolveContextTranslationHarnessSettings({ ...ctxHarness, ...patch });
      setCtxHarness(next);
      setCtxHarnessDraft(formatHarnessJson(next));
      setCtxHarnessError(null);
      saveCtxTransSetting({ harness: next });
    },
    [ctxHarness, saveCtxTransSetting],
  );

  const applyHarnessDraft = useCallback(() => {
    try {
      const parsed = JSON.parse(ctxHarnessDraft) as Partial<ContextTranslationHarnessSettings>;
      const next = resolveContextTranslationHarnessSettings(parsed);
      setCtxHarness(next);
      setCtxHarnessDraft(formatHarnessJson(next));
      setCtxHarnessError(null);
      saveCtxTransSetting({ harness: next });
    } catch {
      setCtxHarnessError(_('Harness JSON is invalid'));
    }
  }, [_, ctxHarnessDraft, saveCtxTransSetting]);

  const resetHarnessDefaults = useCallback(() => {
    setCtxHarness(DEFAULT_CONTEXT_TRANSLATION_HARNESS_SETTINGS);
    setCtxHarnessDraft(formatHarnessJson(DEFAULT_CONTEXT_TRANSLATION_HARNESS_SETTINGS));
    setCtxHarnessError(null);
    saveCtxTransSetting({ harness: DEFAULT_CONTEXT_TRANSLATION_HARNESS_SETTINGS });
  }, [saveCtxTransSetting]);

  const loadHarnessPreset = useCallback(() => {
    const preset = CONTEXT_TRANSLATION_HARNESS_PRESETS[ctxHarnessPreset];
    setCtxHarness(preset);
    setCtxHarnessDraft(formatHarnessJson(preset));
    setCtxHarnessError(null);
    saveCtxTransSetting({ harness: preset });
  }, [ctxHarnessPreset, saveCtxTransSetting]);

  const exportHarnessJson = useCallback(async () => {
    const payload = formatHarnessJson(ctxHarness);
    setCtxHarnessDraft(payload);
    setCtxHarnessError(null);
    try {
      await navigator.clipboard.writeText(payload);
    } catch {
      // Leave the JSON in the textarea as a manual copy fallback.
    }
  }, [ctxHarness]);

  // Sync userDictionaries from settings
  useEffect(() => {
    setUserDictionaries(settings?.userDictionaryMeta ?? []);
  }, [settings?.userDictionaryMeta]);

  const persistUserDictionaryMeta = useCallback(
    async (meta: UserDictionary[]) => {
      const currentSettings = settingsRef.current;
      if (!currentSettings) return;
      const newSettings = { ...currentSettings, userDictionaryMeta: meta };
      settingsRef.current = newSettings;
      setSettings(newSettings);
      await saveSettings(envConfig, newSettings);
      setUserDictionaries(meta);
    },
    [envConfig, saveSettings, setSettings],
  );

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
    } catch {
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
      const importedMeta = await importUserDictionary(selectedZipFile, {
        name: importPreview.name,
        language: importSourceLang,
        targetLanguage: targetLang,
      });
      await persistUserDictionaryMeta([...userDictionaries, importedMeta]);
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
      await persistUserDictionaryMeta(userDictionaries.filter((d) => d.id !== id));
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
      const newSettings = { ...currentSettings, userDictionaryMeta: updated };
      setSettings(newSettings);
      saveSettings(envConfig, newSettings).catch(console.error);
      setUserDictionaries(updated);
    },
    [userDictionaries, envConfig, setSettings, saveSettings],
  );

  // Derived helpers
  const isAiSource = ctxSource === 'ai';
  const aiOnlyDisabled = !ctxEnabled || !isAiSource || !aiEnabled;
  const deeplNeedsLogin = ctxSource === 'deepl' && !token;

  return (
    <div className='my-4 w-full space-y-6'>
      {/* Hidden file input for web dictionary import */}
      <input
        ref={fileInputRef}
        type='file'
        accept='.zip,.dsl,.dsl.dz,.mdx'
        style={{ display: 'none' }}
        onChange={handleFileChange}
      />

      {/* ── Context-Aware Translation ───────────────────────────────── */}
      <div className='w-full'>
        <h2 className='mb-2 font-medium'>{_('Context-Aware Translation')}</h2>
        <p className='text-base-content/70 mb-3 text-sm'>
          {_(
            'When enabled, selecting text in the reader sends surrounding page context for a richer, context-aware translation.',
          )}
        </p>
        <div className='card border-base-200 bg-base-100 border shadow'>
          <div className='divide-base-200 divide-y'>
            {/* Enable toggle */}
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

            {/* Target Language */}
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

            {/* Recent Context Pages — only meaningful for AI path */}
            <div
              className={clsx(
                'config-item',
                (!ctxEnabled || !isAiSource) && 'pointer-events-none select-none opacity-50',
              )}
            >
              <span>{_('Recent Context Pages')}</span>
              <input
                type='number'
                className='input input-bordered input-sm w-20 text-right'
                min={1}
                max={20}
                value={ctxRecentPages}
                disabled={!ctxEnabled || !isAiSource}
                onChange={(e) => {
                  const val = Math.max(1, Math.min(20, parseInt(e.target.value, 10) || 1));
                  setCtxRecentPages(val);
                  saveCtxTransSetting({ recentContextPages: val });
                }}
              />
            </div>

            {/* Look-ahead Words — only meaningful for AI path */}
            <div
              className={clsx(
                'config-item',
                (!ctxEnabled || !isAiSource) && 'pointer-events-none select-none opacity-50',
              )}
            >
              <span>{_('Look-ahead Words')}</span>
              <input
                type='number'
                className='input input-bordered input-sm w-20 text-right'
                min={0}
                max={300}
                value={ctxLookAheadWords}
                disabled={!ctxEnabled || !isAiSource}
                onChange={(e) => {
                  const val = Math.max(0, Math.min(300, parseInt(e.target.value, 10) || 0));
                  setCtxLookAheadWords(val);
                  saveCtxTransSetting({ lookAheadWords: val });
                }}
              />
            </div>

            {/* Memory settings — AI only */}
            <div
              className={clsx(
                'config-item',
                aiOnlyDisabled && 'pointer-events-none select-none opacity-50',
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
                disabled={aiOnlyDisabled}
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
                aiOnlyDisabled && 'pointer-events-none select-none opacity-50',
              )}
            >
              <span>{_('Same-book memory chunks')}</span>
              <input
                type='number'
                className='input input-bordered input-sm w-20 text-right'
                min={1}
                max={10}
                value={ctxSameBookChunkCount}
                disabled={aiOnlyDisabled || !ctxSameBookRagEnabled}
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
                aiOnlyDisabled && 'pointer-events-none select-none opacity-50',
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
                disabled={aiOnlyDisabled}
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
                aiOnlyDisabled && 'pointer-events-none select-none opacity-50',
              )}
            >
              <span>{_('Prior-volume memory chunks')}</span>
              <input
                type='number'
                className='input input-bordered input-sm w-20 text-right'
                min={1}
                max={10}
                value={ctxPriorVolumeChunkCount}
                disabled={aiOnlyDisabled || !ctxPriorVolumeRagEnabled}
                onChange={(e) => {
                  const val = Math.max(1, Math.min(10, parseInt(e.target.value, 10) || 1));
                  setCtxPriorVolumeChunkCount(val);
                  saveCtxTransSetting({ priorVolumeChunkCount: val });
                }}
              />
            </div>

            {/* Output Fields */}
            <div className={clsx(!ctxEnabled && 'pointer-events-none select-none opacity-50')}>
              <div className='px-4 py-2 text-sm font-medium'>{_('Output Fields')}</div>
              <div className='border-base-200 border-t px-4 py-2'>
                <div className='config-item !px-0'>
                  <span className='text-sm'>{_('Parallel per-field mode')}</span>
                  <input
                    type='checkbox'
                    className='toggle toggle-sm'
                    checked={ctxFieldStrategy === 'multi'}
                    disabled={!ctxEnabled || !isAiSource}
                    onChange={() => {
                      const next = ctxFieldStrategy === 'multi' ? 'single' : 'multi';
                      setCtxFieldStrategy(next);
                      saveCtxTransSetting({ fieldStrategy: next });
                    }}
                  />
                </div>
                <div className='config-item mt-2 !px-0'>
                  <span className='text-sm'>{_('Harness flow')}</span>
                  <select
                    className='select select-bordered select-xs'
                    value={ctxHarness.flow}
                    disabled={!ctxEnabled || !isAiSource}
                    onChange={(e) =>
                      saveCtxHarness({
                        flow: e.target.value as ContextTranslationHarnessSettings['flow'],
                      })
                    }
                  >
                    <option value='production'>{_('Production')}</option>
                    <option value='single-pass'>{_('Single pass')}</option>
                  </select>
                </div>
                {ctxFieldStrategy === 'multi' && (
                  <p className='text-warning mt-1 text-xs'>
                    {_('Parallel mode uses one API call per field — costs 3-4× more per lookup.')}
                  </p>
                )}
                <div className='config-item mt-2 !px-0'>
                  <span className='text-sm'>{_('Auto-expand selection to word boundary')}</span>
                  <input
                    type='checkbox'
                    className='toggle toggle-sm'
                    checked={ctxAutoExpand}
                    disabled={!ctxEnabled}
                    onChange={() => {
                      const next = !ctxAutoExpand;
                      setCtxAutoExpand(next);
                      saveCtxTransSetting({ autoExpandSelection: next });
                    }}
                  />
                </div>
                <div className='config-item mt-2 !px-0'>
                  <span className='text-sm'>{_('Repair pass')}</span>
                  <input
                    type='checkbox'
                    className='toggle toggle-sm'
                    checked={ctxHarness.repairEnabled}
                    disabled={!ctxEnabled || !isAiSource}
                    onChange={() => saveCtxHarness({ repairEnabled: !ctxHarness.repairEnabled })}
                  />
                </div>
                <div className='config-item mt-2 !px-0'>
                  <span className='text-sm'>{_('Per-field rescue')}</span>
                  <input
                    type='checkbox'
                    className='toggle toggle-sm'
                    checked={ctxHarness.perFieldRescueEnabled}
                    disabled={!ctxEnabled || !isAiSource}
                    onChange={() =>
                      saveCtxHarness({ perFieldRescueEnabled: !ctxHarness.perFieldRescueEnabled })
                    }
                  />
                </div>
                <div className='config-item mt-2 !px-0'>
                  <span className='text-sm'>{_('Completion threshold')}</span>
                  <input
                    type='number'
                    className='input input-bordered input-xs w-20 text-right'
                    min={0}
                    max={100}
                    value={Math.round(ctxHarness.completionThreshold * 100)}
                    disabled={!ctxEnabled || !isAiSource}
                    onChange={(e) => {
                      const percent = Math.max(0, Math.min(100, parseInt(e.target.value, 10) || 0));
                      saveCtxHarness({ completionThreshold: percent / 100 });
                    }}
                  />
                </div>
                <div className='config-item mt-2 !px-0'>
                  <span className='text-sm'>{_('Translation max words')}</span>
                  <input
                    type='number'
                    className='input input-bordered input-xs w-20 text-right'
                    min={1}
                    max={30}
                    value={ctxHarness.translationMaxWords}
                    disabled={!ctxEnabled || !isAiSource}
                    onChange={(e) => {
                      const value = Math.max(1, Math.min(30, parseInt(e.target.value, 10) || 1));
                      saveCtxHarness({ translationMaxWords: value });
                    }}
                  />
                </div>
                <details className='mt-2'>
                  <summary
                    data-testid='advanced-harness-summary'
                    className={clsx(
                      'text-base-content/60 cursor-pointer text-sm',
                      !isAiSource && 'pointer-events-none opacity-50',
                    )}
                  >
                    {_('Advanced harness')}
                  </summary>
                  <div className='space-y-2 pl-4 pt-2'>
                    <div className='grid gap-2 md:grid-cols-2'>
                      <label className='config-item !px-0'>
                        <span className='text-sm'>{_('Detect contamination')}</span>
                        <input
                          type='checkbox'
                          className='toggle toggle-sm'
                          checked={ctxHarness.detectContamination}
                          onChange={() =>
                            saveCtxHarness({ detectContamination: !ctxHarness.detectContamination })
                          }
                        />
                      </label>
                      <label className='config-item !px-0'>
                        <span className='text-sm'>{_('Sanitize output')}</span>
                        <input
                          type='checkbox'
                          className='toggle toggle-sm'
                          checked={ctxHarness.sanitizeOutput}
                          onChange={() =>
                            saveCtxHarness({ sanitizeOutput: !ctxHarness.sanitizeOutput })
                          }
                        />
                      </label>
                      <label className='config-item !px-0'>
                        <span className='text-sm'>{_('Extract channel tail')}</span>
                        <input
                          type='checkbox'
                          className='toggle toggle-sm'
                          checked={ctxHarness.extractChannelTail}
                          onChange={() =>
                            saveCtxHarness({ extractChannelTail: !ctxHarness.extractChannelTail })
                          }
                        />
                      </label>
                      <label className='config-item !px-0'>
                        <span className='text-sm'>{_('Extract nested tags')}</span>
                        <input
                          type='checkbox'
                          className='toggle toggle-sm'
                          checked={ctxHarness.extractNestedTags}
                          onChange={() =>
                            saveCtxHarness({ extractNestedTags: !ctxHarness.extractNestedTags })
                          }
                        />
                      </label>
                      <label className='config-item !px-0'>
                        <span className='text-sm'>{_('Strip reasoning')}</span>
                        <input
                          type='checkbox'
                          className='toggle toggle-sm'
                          checked={ctxHarness.stripReasoning}
                          onChange={() =>
                            saveCtxHarness({ stripReasoning: !ctxHarness.stripReasoning })
                          }
                        />
                      </label>
                      <label className='config-item !px-0'>
                        <span className='text-sm'>{_('Repair attempts')}</span>
                        <input
                          type='number'
                          className='input input-bordered input-xs w-20 text-right'
                          min={0}
                          max={5}
                          value={ctxHarness.maxRepairAttempts}
                          onChange={(e) => {
                            const value = Math.max(
                              0,
                              Math.min(5, parseInt(e.target.value, 10) || 0),
                            );
                            saveCtxHarness({ maxRepairAttempts: value });
                          }}
                        />
                      </label>
                      <label className='config-item !px-0'>
                        <span className='text-sm'>{_('Per-field retries')}</span>
                        <input
                          type='number'
                          className='input input-bordered input-xs w-20 text-right'
                          min={0}
                          max={5}
                          value={ctxHarness.maxPerFieldRepairAttempts}
                          onChange={(e) => {
                            const value = Math.max(
                              0,
                              Math.min(5, parseInt(e.target.value, 10) || 0),
                            );
                            saveCtxHarness({ maxPerFieldRepairAttempts: value });
                          }}
                        />
                      </label>
                    </div>
                    <div className='flex flex-wrap items-center gap-2'>
                      <label className='text-sm'>{_('Preset')}</label>
                      <select
                        data-testid='harness-preset-select'
                        className='select select-bordered select-xs'
                        value={ctxHarnessPreset}
                        onChange={(e) => setCtxHarnessPreset(e.target.value as HarnessPresetId)}
                      >
                        <option value='balanced'>{_('Balanced')}</option>
                        <option value='strictGemma'>{_('Strict Gemma')}</option>
                        <option value='lenientQwen'>{_('Lenient Qwen')}</option>
                      </select>
                      <button
                        data-testid='load-harness-preset'
                        className='btn btn-ghost btn-sm'
                        onClick={loadHarnessPreset}
                      >
                        {_('Load preset')}
                      </button>
                      <button
                        data-testid='export-harness-json'
                        className='btn btn-ghost btn-sm'
                        onClick={() => {
                          void exportHarnessJson();
                        }}
                      >
                        {_('Export JSON')}
                      </button>
                    </div>
                    <label className='text-sm'>{_('Harness JSON')}</label>
                    <textarea
                      data-testid='harness-json-textarea'
                      className='textarea textarea-bordered w-full font-mono text-xs'
                      rows={12}
                      value={ctxHarnessDraft}
                      onChange={(e) => {
                        setCtxHarnessDraft(e.target.value);
                        setCtxHarnessError(null);
                      }}
                    />
                    {ctxHarnessError && <p className='text-error text-xs'>{ctxHarnessError}</p>}
                    <div className='flex gap-2'>
                      <button
                        data-testid='apply-harness-json'
                        className='btn btn-sm btn-primary'
                        onClick={applyHarnessDraft}
                      >
                        {_('Apply')}
                      </button>
                      <button className='btn btn-ghost btn-sm' onClick={resetHarnessDefaults}>
                        {_('Reset harness defaults')}
                      </button>
                    </div>
                  </div>
                </details>
              </div>
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

                    {/* Translation Source — nested under the Translation field (Fix 3) */}
                    {field.id === 'translation' && (
                      <div className='mt-2 pl-1'>
                        <div className='config-item !px-0 !py-1'>
                          <span className='text-base-content/70 text-xs'>{_('Source')}</span>
                          <select
                            data-testid='translation-source'
                            className='select select-bordered select-xs'
                            value={ctxSource}
                            onChange={(e) => updateSource(e.target.value as TranslationSource)}
                          >
                            <option value='ai' disabled={!aiEnabled}>
                              {_('AI')}
                              {!aiEnabled ? ` (${_('Enable AI first')})` : ''}
                            </option>
                            <option value='dictionary'>{_('Dictionary')}</option>
                            <option value='azure'>{_('Azure')}</option>
                            <option value='deepl'>{_('DeepL')}</option>
                            <option value='google'>{_('Google')}</option>
                            <option value='yandex'>{_('Yandex')}</option>
                          </select>
                        </div>
                        {deeplNeedsLogin && (
                          <p className='text-warning mt-1 text-xs'>
                            {_('DeepL requires your own API key.')}
                          </p>
                        )}
                      </div>
                    )}

                    {/* Advanced prompt — only shown for AI source on non-translation fields,
                        or for translation field when AI is the source */}
                    {(field.id !== 'translation' || isAiSource) && (
                      <details>
                        <summary
                          data-testid={`advanced-${field.id}-summary`}
                          className={clsx(
                            'text-base-content/60 cursor-pointer text-sm',
                            !isAiSource && 'pointer-events-none opacity-50',
                          )}
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
                    )}
                  </div>
                ))}
            </div>
          </div>
        </div>
      </div>

      {/* ── Dictionary Lookup ───────────────────────────────────────── */}
      <div className='w-full'>
        <h2 className='mb-2 font-medium'>{_('Dictionary Lookup')}</h2>
        <p className='text-base-content/70 mb-3 text-sm'>
          {_(
            'When enabled, selecting text in the reader triggers a dictionary lookup. Use AI for context-aware definitions or a traditional dictionary for instant results.',
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

            {/* Dictionary source — available even when AI is disabled */}
            <div
              className={clsx(
                'config-item',
                !ctxDictEnabled && 'pointer-events-none select-none opacity-50',
              )}
            >
              <label htmlFor='ctx-dict-source-select'>{_('Lookup Source')}</label>
              <select
                id='ctx-dict-source-select'
                className='select select-bordered select-sm'
                value={ctxDictSource}
                disabled={!ctxDictEnabled}
                onChange={(e) => {
                  const next = e.target.value as 'ai' | 'dictionary';
                  setCtxDictSource(next);
                  saveCtxDictSetting({ source: next });
                }}
              >
                <option value='ai' disabled={!aiEnabled}>
                  {_('AI')}
                  {!aiEnabled ? ` (${_('Enable AI first')})` : ''}
                </option>
                <option value='dictionary'>{_('Traditional Dictionary')}</option>
              </select>
            </div>

            <div
              className={clsx(
                'config-item',
                (!ctxDictEnabled || ctxDictSource !== 'ai') &&
                  'pointer-events-none select-none opacity-50',
              )}
            >
              <label htmlFor='ctx-dict-source-examples-toggle'>
                {_('Include Source Examples')}
              </label>
              <input
                id='ctx-dict-source-examples-toggle'
                type='checkbox'
                className='toggle'
                checked={ctxDictSourceExamples}
                disabled={!ctxDictEnabled || ctxDictSource !== 'ai'}
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

      {/* ── Dictionaries ───────────────────────────────────────────── */}
      <div className='w-full'>
        <h2 className='mb-2 font-medium'>{_('Dictionaries')}</h2>

        {/* Reference dictionary in AI prompts toggle */}
        <div className='card border-base-200 bg-base-100 mb-3 border shadow'>
          <div className='divide-base-200 divide-y'>
            <div className='config-item'>
              <div>
                <span>{_('Include dictionary definitions in AI prompts')}</span>
                <p className='text-base-content/60 text-xs'>
                  {_(
                    'When enabled, matching dictionary entries are included as context for AI translation',
                  )}
                </p>
              </div>
              <input
                type='checkbox'
                className='toggle'
                checked={ctxTransSettings.referenceDictionaryEnabled !== false}
                onChange={() => {
                  const next = !(ctxTransSettings.referenceDictionaryEnabled !== false);
                  saveCtxTransSetting({ referenceDictionaryEnabled: next });
                }}
              />
            </div>
          </div>
        </div>

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
