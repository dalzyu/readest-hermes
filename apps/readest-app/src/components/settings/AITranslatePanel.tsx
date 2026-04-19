import clsx from 'clsx';
import React, { useCallback, useEffect, useRef, useState } from 'react';
import { PiSpinner, PiTrash } from 'react-icons/pi';
import HelpTip from '@/components/primitives/HelpTip';

import { useTranslation } from '@/hooks/useTranslation';
import { useSettingsStore } from '@/store/settingsStore';
import { useEnv } from '@/context/EnvContext';
import { useAuth } from '@/context/AuthContext';
import {
  previewDictionaryZip,
  importUserDictionary,
  deleteUserDictionary,
  SUPPORTED_DICTIONARY_IMPORT_EXTENSIONS,
  SUPPORTED_DICTIONARY_IMPORT_FORMATS,
} from '@/services/contextTranslation/dictionaryService';
import { getTranslatorLanguageOptions } from '@/services/translatorLanguages';
import type {
  ContextDictionarySettings,
  ContextTranslationFieldSources,
  ContextTranslationSettings,
  UserDictionary,
  ContextDictionaryFieldSource,
} from '@/services/contextTranslation/types';
import {
  DEFAULT_CONTEXT_DICTIONARY_FIELD_SOURCES,
  DEFAULT_CONTEXT_DICTIONARY_OUTPUT_FIELDS,
  DEFAULT_CONTEXT_DICTIONARY_SETTINGS,
  DEFAULT_CONTEXT_TRANSLATION_FIELD_SOURCES,
  DEFAULT_CONTEXT_TRANSLATION_SETTINGS,
  resolveContextDictionaryFieldSources,
  resolveContextTranslationFieldSources,
} from '@/services/contextTranslation/defaults';
import {
  DICTIONARY_SYSTEM_PROMPT_TEMPLATE_VARIABLES,
  TRANSLATION_SYSTEM_PROMPT_TEMPLATE_VARIABLES,
  getMissingPromptTemplateVariables,
} from '@/services/contextTranslation/promptBuilder';
import {
  getTranslators,
  getTranslatorDisplayLabel,
  isTranslatorAvailable,
  type TranslatorName,
} from '@/services/translators/providers';

const DEFAULT_BY_ID: Record<string, string> = Object.fromEntries(
  DEFAULT_CONTEXT_TRANSLATION_SETTINGS.outputFields.map((f) => [f.id, f.promptInstruction]),
);

type TranslationFieldSourceMap = Required<ContextTranslationFieldSources>;
type TranslationFieldKey = keyof TranslationFieldSourceMap;
type TranslationProviderOption = TranslatorName | 'ai';

const DEFAULT_TRANSLATION_PROVIDER: TranslatorName = 'deepl';

function normalizeTranslationProvider(
  provider: string | undefined,
  translationSource: TranslationFieldSourceMap['translation'],
): TranslationProviderOption {
  if (translationSource === 'ai') return 'ai';
  if (
    provider === 'deepl' ||
    provider === 'azure' ||
    provider === 'google' ||
    provider === 'yandex'
  ) {
    return provider;
  }
  return DEFAULT_TRANSLATION_PROVIDER;
}

function getTranslationFieldOptions(
  fieldId: TranslationFieldKey,
  _: (value: string) => string,
  aiEnabled: boolean,
): Array<{
  value: TranslationFieldSourceMap[TranslationFieldKey];
  label: string;
  disabled?: boolean;
}> {
  switch (fieldId) {
    case 'translation':
      return [
        { value: 'ai', label: _('AI'), disabled: !aiEnabled },
        { value: 'translator', label: _('Upstream Translator') },
        { value: 'dictionary', label: _('Dictionary') },
      ];
    case 'contextualMeaning':
      return [
        { value: 'ai', label: _('AI'), disabled: !aiEnabled },
        { value: 'dictionary', label: _('Dictionary') },
      ];
    case 'examples':
      return [
        { value: 'ai', label: _('AI'), disabled: !aiEnabled },
        { value: 'corpus', label: _('Corpus') },
      ];
    case 'grammarHint':
      return [{ value: 'ai', label: _('AI'), disabled: !aiEnabled }];
  }
}
function getErrorMessage(error: unknown, fallback: string): string {
  if (error instanceof Error && error.message.trim()) return error.message;
  if (typeof error === 'string' && error.trim()) return error;
  return fallback;
}

const AITranslatePanel: React.FC = () => {
  const _ = useTranslation();
  const { envConfig } = useEnv();
  const { token } = useAuth();
  const { settings, setSettings, saveSettings } = useSettingsStore();

  const aiEnabled = settings?.aiSettings?.enabled ?? false;
  const developerMode = settings?.aiSettings?.developerMode === true;

  const ctxTransSettings: ContextTranslationSettings =
    settings?.globalReadSettings?.contextTranslation ?? DEFAULT_CONTEXT_TRANSLATION_SETTINGS;

  const ctxDictSettings: ContextDictionarySettings =
    settings?.globalReadSettings?.contextDictionary ?? DEFAULT_CONTEXT_DICTIONARY_SETTINGS;

  const initialTranslationFieldSources = resolveContextTranslationFieldSources(ctxTransSettings);
  const initialTranslationProvider = normalizeTranslationProvider(
    settings?.globalReadSettings?.translationProvider,
    initialTranslationFieldSources.translation,
  );

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
  const [ctxFieldSources, setCtxFieldSources] = useState<TranslationFieldSourceMap>(
    initialTranslationFieldSources,
  );
  const [ctxTranslationProvider, setCtxTranslationProvider] = useState<TranslationProviderOption>(
    initialTranslationProvider,
  );
  const [ctxFieldStrategy, setCtxFieldStrategy] = useState<'single' | 'multi'>(
    ctxTransSettings.fieldStrategy ?? 'single',
  );
  const [ctxAutoExpand, setCtxAutoExpand] = useState(
    ctxTransSettings.autoExpandSelection !== false,
  );

  const [ctxDictEnabled, setCtxDictEnabled] = useState(ctxDictSettings.enabled);
  const [ctxDictSourceExamples, setCtxDictSourceExamples] = useState(
    ctxDictSettings.sourceExamples,
  );
  const [ctxDictFieldSources, setCtxDictFieldSources] = useState(
    resolveContextDictionaryFieldSources(ctxDictSettings),
  );
  const [ctxDictPromptInstructions, setCtxDictPromptInstructions] = useState(
    ctxDictSettings.promptInstructions ?? {},
  );
  const [ctxSystemPromptTemplate, setCtxSystemPromptTemplate] = useState(
    ctxTransSettings.systemPromptTemplate ?? '',
  );
  const [ctxSystemPromptTemplateError, setCtxSystemPromptTemplateError] = useState<string | null>(
    null,
  );
  const [ctxDictSystemPromptTemplate, setCtxDictSystemPromptTemplate] = useState(
    ctxDictSettings.systemPromptTemplate ?? '',
  );
  const [ctxDictSystemPromptTemplateError, setCtxDictSystemPromptTemplateError] = useState<
    string | null
  >(null);
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
      const newSettings = {
        ...currentSettings,
        globalReadSettings: {
          ...currentSettings.globalReadSettings,
          contextTranslation: { ...current, ...patch },
        },
      };
      settingsRef.current = newSettings;
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
      settingsRef.current = newSettings;
      setSettings(newSettings);
      saveSettings(envConfig, newSettings).catch(console.error);
    },
    [envConfig, setSettings, saveSettings],
  );

  const saveGlobalReadSetting = useCallback(
    (patch: Partial<typeof settings.globalReadSettings>) => {
      const currentSettings = settingsRef.current;
      if (!currentSettings) return;
      const newSettings = {
        ...currentSettings,
        globalReadSettings: {
          ...currentSettings.globalReadSettings,
          ...patch,
        },
      };
      settingsRef.current = newSettings;
      setSettings(newSettings);
      saveSettings(envConfig, newSettings).catch(console.error);
    },
    [envConfig, setSettings, saveSettings],
  );

  const resolvedTranslationFieldSources: TranslationFieldSourceMap = {
    ...DEFAULT_CONTEXT_TRANSLATION_FIELD_SOURCES,
    ...ctxFieldSources,
  };
  const resolvedDictFieldSources = {
    ...DEFAULT_CONTEXT_DICTIONARY_FIELD_SOURCES,
    ...ctxDictFieldSources,
  };
  const ctxDictOutputFields = DEFAULT_CONTEXT_DICTIONARY_OUTPUT_FIELDS.map((field) => {
    const source =
      field.id === 'simpleDefinition'
        ? resolvedDictFieldSources.simpleDefinition
        : field.id === 'contextualMeaning'
          ? resolvedDictFieldSources.contextualMeaning
          : resolvedDictFieldSources.sourceExamples;
    const enabled = source === 'ai' && (field.id !== 'sourceExamples' || ctxDictSourceExamples);
    return {
      ...field,
      enabled,
      promptInstruction: ctxDictPromptInstructions[field.id] ?? field.promptInstruction,
    };
  });

  const updateTranslationFieldSource = useCallback(
    (fieldId: TranslationFieldKey, source: TranslationFieldSourceMap[TranslationFieldKey]) => {
      const next = {
        ...resolvedTranslationFieldSources,
        [fieldId]: source,
      } as TranslationFieldSourceMap;
      setCtxFieldSources(next);
      saveCtxTransSetting({ fieldSources: next, source: undefined });

      if (fieldId === 'translation' && source === 'translator' && ctxTranslationProvider === 'ai') {
        setCtxTranslationProvider(DEFAULT_TRANSLATION_PROVIDER);
        saveGlobalReadSetting({ translationProvider: DEFAULT_TRANSLATION_PROVIDER });
      }
    },
    [
      resolvedTranslationFieldSources,
      saveCtxTransSetting,
      ctxTranslationProvider,
      saveGlobalReadSetting,
    ],
  );

  const updateTranslationProviderSelection = useCallback(
    (value: TranslationProviderOption) => {
      setCtxTranslationProvider(value);
      saveGlobalReadSetting({ translationProvider: value });

      if (value === 'ai') {
        if (resolvedTranslationFieldSources.translation !== 'ai') {
          const next = {
            ...resolvedTranslationFieldSources,
            translation: 'ai',
          } as TranslationFieldSourceMap;
          setCtxFieldSources(next);
          saveCtxTransSetting({ fieldSources: next, source: undefined });
        }
        return;
      }

      if (resolvedTranslationFieldSources.translation !== 'translator') {
        const next = {
          ...resolvedTranslationFieldSources,
          translation: 'translator',
        } as TranslationFieldSourceMap;
        setCtxFieldSources(next);
        saveCtxTransSetting({ fieldSources: next, source: undefined });
      }
    },
    [resolvedTranslationFieldSources, saveGlobalReadSetting, saveCtxTransSetting],
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

  const updateDictFieldSource = useCallback(
    (fieldId: string, source: ContextDictionaryFieldSource) => {
      if (!['simpleDefinition', 'contextualMeaning', 'sourceExamples'].includes(fieldId)) return;
      const key = fieldId as keyof typeof DEFAULT_CONTEXT_DICTIONARY_FIELD_SOURCES;
      const next = { ...resolvedDictFieldSources, [key]: source };
      setCtxDictFieldSources(next);
      saveCtxDictSetting({ fieldSources: next });
    },
    [resolvedDictFieldSources, saveCtxDictSetting],
  );

  const updateDictPrompt = useCallback(
    (fieldId: string, instruction: string) => {
      const next = { ...ctxDictPromptInstructions, [fieldId]: instruction };
      setCtxDictPromptInstructions(next);
      saveCtxDictSetting({ promptInstructions: next });
    },
    [ctxDictPromptInstructions, saveCtxDictSetting],
  );

  const resetDictPromptToDefault = useCallback(
    (fieldId: string) => {
      const next = { ...ctxDictPromptInstructions };
      delete next[fieldId];
      setCtxDictPromptInstructions(next);
      saveCtxDictSetting({ promptInstructions: next });
    },
    [ctxDictPromptInstructions, saveCtxDictSetting],
  );

  const saveTranslationSystemPromptTemplate = useCallback(() => {
    const template = ctxSystemPromptTemplate.trim();
    if (!template) {
      setCtxSystemPromptTemplateError(null);
      saveCtxTransSetting({ systemPromptTemplate: undefined });
      return;
    }
    const missing = getMissingPromptTemplateVariables(
      template,
      TRANSLATION_SYSTEM_PROMPT_TEMPLATE_VARIABLES,
    );
    if (missing.length > 0) {
      setCtxSystemPromptTemplateError(
        _('Missing required variables: {{vars}}', {
          vars: missing.map((variable) => `{{${variable}}}`).join(', '),
        }),
      );
      return;
    }
    setCtxSystemPromptTemplateError(null);
    saveCtxTransSetting({ systemPromptTemplate: template });
  }, [ctxSystemPromptTemplate, saveCtxTransSetting, _]);

  const saveDictionarySystemPromptTemplate = useCallback(() => {
    const template = ctxDictSystemPromptTemplate.trim();
    if (!template) {
      setCtxDictSystemPromptTemplateError(null);
      saveCtxDictSetting({ systemPromptTemplate: undefined });
      return;
    }
    const missing = getMissingPromptTemplateVariables(
      template,
      DICTIONARY_SYSTEM_PROMPT_TEMPLATE_VARIABLES,
    );
    if (missing.length > 0) {
      setCtxDictSystemPromptTemplateError(
        _('Missing required variables: {{vars}}', {
          vars: missing.map((variable) => `{{${variable}}}`).join(', '),
        }),
      );
      return;
    }
    setCtxDictSystemPromptTemplateError(null);
    saveCtxDictSetting({ systemPromptTemplate: template });
  }, [ctxDictSystemPromptTemplate, saveCtxDictSetting, _]);

  const resetTranslationSystemPromptTemplate = useCallback(() => {
    setCtxSystemPromptTemplate('');
    setCtxSystemPromptTemplateError(null);
    saveCtxTransSetting({ systemPromptTemplate: undefined });
  }, [saveCtxTransSetting]);

  const resetDictionarySystemPromptTemplate = useCallback(() => {
    setCtxDictSystemPromptTemplate('');
    setCtxDictSystemPromptTemplateError(null);
    saveCtxDictSetting({ systemPromptTemplate: undefined });
  }, [saveCtxDictSetting]);

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
    } catch (error) {
      setImportError(getErrorMessage(error, _('Failed to read dictionary file')));
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
      setImportError(getErrorMessage(err, _('Failed to import dictionary')));
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
  const hasToken = Boolean(token);
  const translatorProviders = getTranslators();
  const getTranslationFieldSource = (
    fieldId: string,
  ): TranslationFieldSourceMap[TranslationFieldKey] => {
    switch (fieldId) {
      case 'translation':
        return resolvedTranslationFieldSources.translation;
      case 'contextualMeaning':
        return resolvedTranslationFieldSources.contextualMeaning;
      case 'examples':
        return resolvedTranslationFieldSources.examples;
      case 'grammarHint':
        return resolvedTranslationFieldSources.grammarHint;
      default:
        return 'ai';
    }
  };
  const fieldUsesAi = (fieldId: string): boolean => getTranslationFieldSource(fieldId) === 'ai';
  const hasAnyAiField = ctxOutputFields.some((field) => field.enabled && fieldUsesAi(field.id));
  const translationProviderSelection: TranslationProviderOption =
    resolvedTranslationFieldSources.translation === 'ai' ? 'ai' : ctxTranslationProvider;
  const aiOnlyDisabled = !ctxEnabled || !hasAnyAiField || !aiEnabled;

  return (
    <div className='my-4 w-full space-y-6'>
      {/* Hidden file input for web dictionary import */}
      <input
        ref={fileInputRef}
        type='file'
        accept={SUPPORTED_DICTIONARY_IMPORT_EXTENSIONS.join(',')}
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
              <span className='flex items-center gap-1'>
                {_('Enable Context-Aware Translation')}
                <HelpTip
                  tip={_(
                    'When enabled, selecting text sends surrounding page context to the AI for a richer, context-aware result.',
                  )}
                />
              </span>
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
              <span className='flex items-center gap-1'>
                {_('Target Language')}
                <HelpTip tip={_('The language the AI will translate into.')} />
              </span>
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
                'config-item !h-auto flex-col !items-start gap-2 py-3',
                !ctxEnabled && 'pointer-events-none select-none opacity-50',
              )}
            >
              <span className='flex items-center gap-1'>
                {_('Translation Provider')}
                <HelpTip
                  tip={_(
                    'Choose the preferred upstream translator. Selecting AI routes the translation field back through the LLM.',
                  )}
                />
              </span>
              <select
                data-testid='translation-provider-select'
                className='select select-bordered select-sm bg-base-100 text-base-content w-full'
                value={translationProviderSelection}
                disabled={
                  !ctxEnabled || resolvedTranslationFieldSources.translation === 'dictionary'
                }
                onChange={(e) =>
                  updateTranslationProviderSelection(e.target.value as TranslationProviderOption)
                }
              >
                <option value='ai'>{_('AI')}</option>
                {translatorProviders.map((translator) => (
                  <option
                    key={translator.name}
                    value={translator.name}
                    disabled={!isTranslatorAvailable(translator, hasToken)}
                  >
                    {getTranslatorDisplayLabel(translator, hasToken, _)}
                  </option>
                ))}
              </select>
            </div>

            {/* Recent Context Pages — only meaningful for AI path */}
            <div
              className={clsx(
                'config-item',
                aiOnlyDisabled && 'pointer-events-none select-none opacity-50',
              )}
            >
              <span>{_('Recent Context Pages')}</span>
              <input
                type='number'
                className='input input-bordered input-sm w-20 text-right'
                min={1}
                max={20}
                value={ctxRecentPages}
                disabled={aiOnlyDisabled}
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
                aiOnlyDisabled && 'pointer-events-none select-none opacity-50',
              )}
            >
              <span>{_('Look-ahead Words')}</span>
              <input
                type='number'
                className='input input-bordered input-sm w-20 text-right'
                min={0}
                max={300}
                value={ctxLookAheadWords}
                disabled={aiOnlyDisabled}
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
                aiOnlyDisabled && 'pointer-events-none select-none opacity-50',
              )}
            >
              <label className='flex items-center gap-2' htmlFor='ctx-auto-index-on-open-toggle'>
                <span className='flex items-center gap-1'>
                  {_('Auto-index on open')}
                  <HelpTip
                    tip={_(
                      'Automatically indexes each book the first time you open it, enabling same-book and cross-volume context retrieval.',
                    )}
                  />
                </span>
              </label>
              <input
                id='ctx-auto-index-on-open-toggle'
                type='checkbox'
                className='toggle'
                checked={settings?.globalReadSettings?.autoIndexOnOpen ?? false}
                disabled={aiOnlyDisabled}
                onChange={(e) => saveGlobalReadSetting({ autoIndexOnOpen: e.target.checked })}
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
                <span className='flex items-center gap-1'>
                  {_('Use same-book memory')}
                  <HelpTip
                    tip={_(
                      'Finds relevant passages from the current book to give the AI additional context for each lookup.',
                    )}
                  />
                </span>
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
                <span className='flex items-center gap-1'>
                  {_('Use prior-volume memory')}
                  <HelpTip
                    tip={_(
                      'Allows the AI to reference passages from earlier volumes in a series for context.',
                    )}
                  />
                </span>
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
                    disabled={aiOnlyDisabled}
                    onChange={() => {
                      const next = ctxFieldStrategy === 'multi' ? 'single' : 'multi';
                      setCtxFieldStrategy(next);
                      saveCtxTransSetting({ fieldStrategy: next });
                    }}
                  />
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
              </div>
              {ctxOutputFields
                .slice()
                .sort((a, b) => a.order - b.order)
                .map((field) => {
                  const fieldKey = field.id as TranslationFieldKey;
                  const fieldSource = getTranslationFieldSource(field.id);
                  const sourceOptions = getTranslationFieldOptions(fieldKey, _, aiEnabled);
                  const promptUsesAi = fieldUsesAi(field.id);

                  return (
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

                      <div className='mt-2 pl-1'>
                        <div className='config-item !px-0 !py-1'>
                          <span className='text-base-content/70 text-xs'>{_('Source')}</span>
                          <select
                            data-testid={`translation-field-source-${field.id}`}
                            className='select select-bordered select-xs'
                            value={fieldSource}
                            disabled={!ctxEnabled}
                            onChange={(e) =>
                              updateTranslationFieldSource(
                                fieldKey,
                                e.target.value as TranslationFieldSourceMap[TranslationFieldKey],
                              )
                            }
                          >
                            {sourceOptions.map((option) => (
                              <option
                                key={option.value}
                                value={option.value}
                                disabled={option.disabled}
                              >
                                {option.label}
                              </option>
                            ))}
                          </select>
                        </div>
                      </div>

                      {promptUsesAi && (
                        <details>
                          <summary
                            data-testid={`advanced-${field.id}-summary`}
                            className='text-base-content/60 cursor-pointer text-sm'
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
                  );
                })}
              {developerMode && (
                <div className='border-base-200 border-t px-4 py-3'>
                  <div className='text-warning text-xs font-semibold'>
                    {_(
                      'Danger zone: invalid templates can break lookups. Keep all required variables.',
                    )}
                  </div>
                  <p className='text-base-content/60 mt-2 text-xs'>
                    {_('Template variables use Jinja syntax.')} <code>{'{{targetLang}}'}</code>,{' '}
                    <code>{'{{sourceLang}}'}</code>.
                  </p>
                  <p className='text-base-content/60 mt-1 text-xs'>
                    {_('Required variables')}:{' '}
                    {TRANSLATION_SYSTEM_PROMPT_TEMPLATE_VARIABLES.map(
                      (variable) => `{{${variable}}}`,
                    ).join(', ')}
                  </p>
                  <textarea
                    data-testid='translation-system-prompt-template'
                    className='textarea textarea-bordered mt-2 w-full text-sm'
                    rows={8}
                    value={ctxSystemPromptTemplate}
                    onChange={(event) => {
                      setCtxSystemPromptTemplate(event.target.value);
                      setCtxSystemPromptTemplateError(null);
                    }}
                    placeholder={_('Leave empty to use the built-in system prompt')}
                  />
                  {ctxSystemPromptTemplateError && (
                    <p className='text-error mt-2 text-xs'>{ctxSystemPromptTemplateError}</p>
                  )}
                  <div className='mt-2 flex gap-2'>
                    <button
                      className='btn btn-primary btn-sm'
                      onClick={saveTranslationSystemPromptTemplate}
                    >
                      {_('Save template')}
                    </button>
                    <button
                      className='btn btn-ghost btn-sm'
                      onClick={resetTranslationSystemPromptTemplate}
                    >
                      {_('Reset to built-in prompt')}
                    </button>
                  </div>
                </div>
              )}
            </div>
          </div>
        </div>
      </div>

      {/* ── Dictionary Lookup ───────────────────────────────────────── */}
      <div className='w-full'>
        <h2 className='mb-2 font-medium'>{_('Dictionary Lookup')}</h2>
        <p className='text-base-content/70 mb-3 text-sm'>
          {_(
            'When enabled, selecting text in the reader triggers a dictionary lookup. Use AI for context-aware definitions.',
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

            <div
              className={clsx(
                'config-item',
                !ctxDictEnabled && 'pointer-events-none select-none opacity-50',
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
                disabled={!ctxDictEnabled}
                onChange={() => {
                  const next = !ctxDictSourceExamples;
                  setCtxDictSourceExamples(next);
                  saveCtxDictSetting({ sourceExamples: next });
                }}
              />
            </div>
            {ctxDictOutputFields.map((field) => {
              const source =
                field.id === 'simpleDefinition'
                  ? resolvedDictFieldSources.simpleDefinition
                  : field.id === 'contextualMeaning'
                    ? resolvedDictFieldSources.contextualMeaning
                    : resolvedDictFieldSources.sourceExamples;
              const aiSelected = source === 'ai';
              const sourceControlDisabled =
                !ctxDictEnabled || (field.id === 'sourceExamples' && !ctxDictSourceExamples);

              return (
                <div key={field.id} className='border-base-200 border-t px-4 py-2'>
                  <div className='config-item !px-0'>
                    <span className='text-sm'>{_(field.label)}</span>
                    <select
                      data-testid={`dictionary-source-${field.id}`}
                      className='select select-bordered select-xs'
                      value={source}
                      disabled={sourceControlDisabled}
                      onChange={(e) =>
                        updateDictFieldSource(
                          field.id,
                          e.target.value as ContextDictionaryFieldSource,
                        )
                      }
                    >
                      <option value='dictionary'>{_('Dictionary')}</option>
                      <option value='ai' disabled={!aiEnabled}>
                        {_('AI')}
                        {!aiEnabled ? ` (${_('Enable AI first')})` : ''}
                      </option>
                    </select>
                  </div>

                  {aiSelected && field.enabled && (
                    <details>
                      <summary className='text-base-content/60 cursor-pointer text-sm'>
                        {_('Advanced')}
                      </summary>
                      <div className='space-y-2 pl-4 pt-2'>
                        <label className='text-sm'>{_('Prompt instruction:')}</label>
                        <textarea
                          data-testid={`dictionary-prompt-textarea-${field.id}`}
                          className='textarea textarea-bordered w-full text-sm'
                          rows={3}
                          value={field.promptInstruction}
                          onChange={(e) => updateDictPrompt(field.id, e.target.value)}
                        />
                        <button
                          data-testid={`dictionary-reset-prompt-${field.id}`}
                          className='btn btn-ghost btn-sm'
                          onClick={() => resetDictPromptToDefault(field.id)}
                        >
                          {_('Reset to defaults')}
                        </button>
                      </div>
                    </details>
                  )}
                </div>
              );
            })}
            {developerMode && (
              <div className='border-base-200 border-t px-4 py-3'>
                <div className='text-warning text-xs font-semibold'>
                  {_(
                    'Danger zone: invalid templates can break dictionary lookups. Keep all required variables.',
                  )}
                </div>
                <p className='text-base-content/60 mt-2 text-xs'>
                  {_('Template variables use Jinja syntax.')} <code>{'{{sourceLang}}'}</code>,{' '}
                  <code>{'{{fieldInstructions}}'}</code>.
                </p>
                <p className='text-base-content/60 mt-1 text-xs'>
                  {_('Required variables')}:{' '}
                  {DICTIONARY_SYSTEM_PROMPT_TEMPLATE_VARIABLES.map(
                    (variable) => `{{${variable}}}`,
                  ).join(', ')}
                </p>
                <textarea
                  data-testid='dictionary-system-prompt-template'
                  className='textarea textarea-bordered mt-2 w-full text-sm'
                  rows={8}
                  value={ctxDictSystemPromptTemplate}
                  onChange={(event) => {
                    setCtxDictSystemPromptTemplate(event.target.value);
                    setCtxDictSystemPromptTemplateError(null);
                  }}
                  placeholder={_('Leave empty to use the built-in system prompt')}
                />
                {ctxDictSystemPromptTemplateError && (
                  <p className='text-error mt-2 text-xs'>{ctxDictSystemPromptTemplateError}</p>
                )}
                <div className='mt-2 flex gap-2'>
                  <button
                    className='btn btn-primary btn-sm'
                    onClick={saveDictionarySystemPromptTemplate}
                  >
                    {_('Save template')}
                  </button>
                  <button
                    className='btn btn-ghost btn-sm'
                    onClick={resetDictionarySystemPromptTemplate}
                  >
                    {_('Reset to built-in prompt')}
                  </button>
                </div>
              </div>
            )}
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

        <div className='card border-base-200 bg-base-100 border shadow'>
          {/* User Dictionaries sub-section */}
          <div className='px-4 py-3'>
            <div className='mb-2 flex items-center justify-between'>
              <h3 className='text-sm font-medium'>{_('User Dictionaries')}</h3>
              <button className='btn btn-outline btn-xs' onClick={handleAddDictionaryClick}>
                {_('Add Dictionary')}
              </button>
            </div>

            <div className='text-base-content/70 mb-2 text-xs'>
              {`${_('Supported formats')}: ${SUPPORTED_DICTIONARY_IMPORT_FORMATS}`}
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
