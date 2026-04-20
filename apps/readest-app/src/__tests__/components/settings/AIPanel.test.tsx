import React from 'react';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest';

import AIPanel from '@/components/settings/AIPanel';
import AITranslatePanel from '@/components/settings/AITranslatePanel';
import SettingsDialog from '@/components/settings/SettingsDialog';

const saveSettingsMock = vi.fn().mockResolvedValue(undefined);
const setSettingsMock = vi.fn();
const writeClipboardMock = vi.fn().mockResolvedValue(undefined);

// vi.hoisted runs before vi.mock factories — use it to create stable object references
// that won't cause useEffect infinite re-render loops.
const { stableSettings } = vi.hoisted(() => {
  const stableSettings = {
    aiSettings: {
      enabled: false,
      providers: [
        {
          id: 'ollama-default',
          name: 'Ollama',
          providerType: 'ollama',
          baseUrl: 'http://127.0.0.1:11434',
          model: 'llama3.2',
          embeddingModel: 'nomic-embed-text',
        },
      ],
      activeProviderId: 'ollama-default',
      modelAssignments: {},
      spoilerProtection: true,
      maxContextChunks: 10,
      indexingMode: 'on-demand',
    },
    globalReadSettings: {
      contextTranslation: {
        enabled: true,
        targetLanguage: 'en',
        recentContextPages: 3,
        lookAheadWords: 80,
        sameBookRagEnabled: true,
        priorVolumeRagEnabled: true,
        sameBookChunkCount: 3,
        priorVolumeChunkCount: 2,
        fieldSources: {
          translation: 'ai',
          contextualMeaning: 'ai',
          examples: 'ai',
          grammarHint: 'ai',
        },
        harness: {
          flow: 'production',
          repairEnabled: true,
          repairOnContamination: true,
          repairOnMissingPrimary: true,
          repairOnLowCompletion: true,
          completionThreshold: 0.5,
          maxRepairAttempts: 1,
          perFieldRescueEnabled: true,
          maxPerFieldRepairAttempts: 1,
          detectContamination: true,
          sanitizeOutput: true,
          extractChannelTail: true,
          extractNestedTags: true,
          stripReasoning: true,
          translationMaxWords: 8,
          contaminationMarkers: ['Thinking Process', 'Confidence Score'],
          reasoningMarkers: ['Thinking Process', 'The user wants me'],
        },
        outputFields: [
          {
            id: 'translation',
            label: 'Translation',
            enabled: true,
            order: 0,
            promptInstruction:
              'Provide a concise, direct translation of the selected text into the target language.',
          },
          {
            id: 'contextualMeaning',
            label: 'Contextual Meaning',
            enabled: true,
            order: 1,
            promptInstruction:
              'Explain what the selected word or phrase specifically means given the surrounding narrative context. Note any nuances, connotations, or cultural significance that differ from a generic dictionary definition.',
          },
          {
            id: 'examples',
            label: 'Usage Examples',
            enabled: false,
            order: 2,
            promptInstruction:
              'Provide 2\u20133 short example sentences using the selected term in similar contexts.',
          },
        ],
      },
      contextDictionary: {
        enabled: false,
        sourceExamples: true,
      },
      translationProvider: 'azure',
    },
    userDictionaryMeta: [
      {
        id: 'user-1',
        name: 'My Test Dict',
        language: 'zh',
        targetLanguage: 'en',
        entryCount: 42,
        source: 'user' as const,
        importedAt: 1_700_000_000,
        enabled: true,
      },
    ],
    globalViewSettings: {
      uiLanguage: '',
      translationEnabled: false,
      translationProvider: 'google',
      translateTargetLang: '',
      showTranslateSource: false,
      ttsReadAloudText: 'both',
      replaceQuotationMarks: false,
      convertChineseVariant: 'none',
    },
  };
  return { stableSettings };
});

vi.mock('@/hooks/useTranslation', () => ({
  useTranslation: () => (value: string) => value,
}));

vi.mock('@/context/EnvContext', () => ({
  useEnv: () => ({ envConfig: {} }),
}));

vi.mock('@/services/ai/providers', () => ({
  createProviderFromConfig: () => ({
    healthCheck: vi.fn().mockResolvedValue(true),
    isAvailable: vi.fn().mockResolvedValue(true),
  }),
  getAIProvider: () => ({
    healthCheck: vi.fn().mockResolvedValue(true),
    isAvailable: vi.fn().mockResolvedValue(true),
  }),
}));

vi.mock('@/utils/simplecc', () => ({
  initSimpleCC: vi.fn().mockResolvedValue(undefined),
  runSimpleCC: vi.fn((text: string) => text),
}));

vi.mock('@/utils/supabase', () => ({
  supabase: {
    auth: { getSession: vi.fn().mockResolvedValue({ data: { session: null } }) },
  },
}));

vi.mock('@/context/AuthContext', () => ({
  useAuth: () => ({ token: null }),
}));

vi.mock('@/store/readerStore', () => ({
  useReaderStore: () => ({
    getView: vi.fn().mockReturnValue(null),
    getViewSettings: vi.fn().mockReturnValue(null),
    setViewSettings: vi.fn(),
    recreateViewer: vi.fn(),
  }),
}));

vi.mock('@/components/settings/FontPanel', () => ({
  default: () => null,
}));

vi.mock('@/components/settings/LayoutPanel', () => ({
  default: () => null,
}));

vi.mock('@/components/settings/ColorPanel', () => ({
  default: () => null,
}));

vi.mock('@/components/settings/ControlPanel', () => ({
  default: () => null,
}));

vi.mock('@/components/settings/LangPanel', () => ({
  default: () => null,
}));

vi.mock('@/components/settings/MiscPanel', () => ({
  default: () => null,
}));

vi.mock('@/components/command-palette', () => ({
  useCommandPalette: () => ({ open: vi.fn() }),
  CommandPalette: () => null,
  CommandPaletteProvider: ({ children }: { children: React.ReactNode }) => children,
}));

vi.mock('@/store/settingsStore', () => {
  const useSettingsStore = () => ({
    settings: stableSettings,
    setSettings: setSettingsMock,
    saveSettings: saveSettingsMock,
    setFontPanelView: vi.fn(),
    setSettingsDialogOpen: vi.fn(),
    activeSettingsItemId: null,
    setActiveSettingsItemId: vi.fn(),
    applyUILanguage: vi.fn(),
  });
  // AITranslatePanel uses useSettingsStore.getState() in handleImportConfirm
  useSettingsStore.getState = () => ({ settings: stableSettings });
  return { useSettingsStore };
});

vi.mock('@/services/contextTranslation/dictionaryService', () => ({
  SUPPORTED_DICTIONARY_IMPORT_EXTENSIONS: [
    '.zip',
    '.dsl',
    '.dsl.dz',
    '.csv',
    '.tsv',
    '.txt',
    '.json',
    '.jsonl',
  ],
  SUPPORTED_DICTIONARY_IMPORT_FORMATS:
    'StarDict (.zip), DSL (.dsl/.dz), CSV (.csv), TSV (.tsv), plain text (.txt), JSON (.json/.jsonl)',
  previewDictionaryZip: vi.fn().mockResolvedValue({ name: 'TestDict', wordcount: 100 }),
  importUserDictionary: vi.fn().mockResolvedValue({}),
  deleteUserDictionary: vi.fn().mockResolvedValue(undefined),
}));

describe('AIPanel', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    stableSettings.aiSettings.enabled = false;
    stableSettings.globalReadSettings.contextTranslation.fieldSources = {
      translation: 'ai',
      contextualMeaning: 'ai',
      examples: 'ai',
      grammarHint: 'ai',
    };
    stableSettings.globalReadSettings.translationProvider = 'azure';
    Object.defineProperty(global.navigator, 'clipboard', {
      value: { writeText: writeClipboardMock },
      configurable: true,
    });
  });

  afterEach(() => {
    cleanup();
  });

  test('renders separate toggles for same-book and prior-volume memory', () => {
    render(<AITranslatePanel />);

    expect(screen.getByText('Use same-book memory')).toBeTruthy();
    expect(screen.getByText('Use prior-volume memory')).toBeTruthy();
  });

  test('profiles can persist explicit reasoning off mode', async () => {
    stableSettings.aiSettings.enabled = true;
    render(<AIPanel />);

    fireEvent.click(screen.getByRole('button', { name: /AI Profiles/i }));
    fireEvent.change(screen.getByTestId('task-reasoning-translation'), {
      target: { value: 'off' },
    });

    await waitFor(() => expect(saveSettingsMock).toHaveBeenCalled());

    const savedAiSettings = (
      saveSettingsMock.mock.calls.at(-1)?.[1] as {
        aiSettings: {
          profiles?: Array<{
            inferenceParamsByTask: { translation?: { reasoningEffort?: string } };
          }>;
        };
      }
    ).aiSettings;
    expect(savedAiSettings.profiles?.[0]?.inferenceParamsByTask.translation?.reasoningEffort).toBe(
      'off',
    );
  });

  test('renders provider list with configured providers', () => {
    render(<AIPanel />);

    expect(screen.getByText('Providers')).toBeTruthy();
    // The default Ollama provider should be listed
    expect(screen.getAllByText('Ollama').length).toBeGreaterThan(0);
  });

  test('edits provider display name and model entries', async () => {
    render(<AIPanel />);

    fireEvent.click(screen.getByTitle('Edit'));

    fireEvent.change(screen.getByPlaceholderText('Ollama'), { target: { value: 'Local Ollama' } });
    fireEvent.change(screen.getByDisplayValue('llama3.2'), { target: { value: 'llama3.3' } });
    fireEvent.change(screen.getByDisplayValue('nomic-embed-text'), { target: { value: 'bge-m3' } });

    fireEvent.click(screen.getByRole('button', { name: 'Save' }));

    await waitFor(() => expect(saveSettingsMock).toHaveBeenCalled());

    const savedSettings = saveSettingsMock.mock.calls.at(-1)?.[1] as typeof stableSettings;
    const savedProvider = savedSettings.aiSettings.providers[0] as {
      name: string;
      models?: Array<{ id: string; kind: 'chat' | 'embedding' }>;
    };

    expect(savedProvider.name).toBe('Local Ollama');
    expect(savedProvider.models).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ id: 'llama3.3', kind: 'chat' }),
        expect.objectContaining({ id: 'bge-m3', kind: 'embedding' }),
      ]),
    );
  });

  test('uses the full shared translator language list for context translation targets', () => {
    render(<AITranslatePanel />);

    expect(screen.getAllByRole('option', { name: 'Bokmål' }).length).toBeGreaterThan(0);
  });

  test('saves same-book memory setting independently', () => {
    render(<AITranslatePanel />);

    const sameBookToggle = screen.getByLabelText('Use same-book memory');
    fireEvent.click(sameBookToggle);

    expect(setSettingsMock).toHaveBeenCalled();
    expect(saveSettingsMock).toHaveBeenCalled();
  });

  test('ai panel persists dictionary settings separately from translation settings', () => {
    render(<AITranslatePanel />);
    expect(screen.getByLabelText(/enable dictionary lookup/i)).toBeTruthy();
  });

  test('renders Dictionaries section with user section', () => {
    render(<AITranslatePanel />);
    expect(screen.getByText('Dictionaries')).toBeTruthy();
    expect(screen.getByText('User Dictionaries')).toBeTruthy();
    expect(screen.queryByText('Bundled Dictionaries')).toBeNull();
  });

  test('shows Add Dictionary button in User Dictionaries section', () => {
    render(<AITranslatePanel />);
    expect(screen.getByText('Add Dictionary')).toBeTruthy();
  });

  test('shows supported dictionary import formats', () => {
    render(<AITranslatePanel />);
    expect(screen.getByText(/Supported formats:/)).toBeTruthy();
  });

  test('SettingsDialog renders AI Translate tab button', () => {
    render(<SettingsDialog bookKey='test' />);
    expect(screen.getByRole('button', { name: /AI Translate/i })).toBeTruthy();
  });

  test('Translation field has collapsible Advanced section', () => {
    render(<AITranslatePanel />);
    // Native <details> toggle works in jsdom
    const summary = screen.getByTestId('advanced-translation-summary');
    fireEvent.click(summary);
    expect(screen.getByTestId('prompt-textarea-translation')).toBeTruthy();
  });

  test('Reset restores default prompt instruction', () => {
    render(<AITranslatePanel />);
    const textarea = screen.getByTestId('prompt-textarea-translation') as HTMLTextAreaElement;
    const defaultValue =
      'Provide ONLY the translated word or short phrase in the target language (1-3 words maximum). Do NOT include explanations, alternatives, parentheticals, or meta-commentary. If there is no exact equivalent, choose the single closest concept.';

    // Edit the textarea to something different
    fireEvent.change(textarea, { target: { value: 'custom instruction' } });
    expect(textarea.value).toBe('custom instruction');

    // Reset — should restore the default
    const resetBtn = screen.getByTestId('reset-prompt-translation');
    fireEvent.click(resetBtn);
    expect(textarea.value).toBe(defaultValue);
  });

  test('bundled dictionary controls are no longer shown', () => {
    render(<AITranslatePanel />);
    expect(screen.queryByTestId('bundled-dict-toggle-bundled-zh-en')).toBeNull();
    expect(screen.queryByTestId('bundled-dict-toggle-bundled-ja-en')).toBeNull();
  });

  test('user dictionary enable toggle updates checked state when clicked', async () => {
    render(<AITranslatePanel />);
    // stableSettings has 'user-1' enabled:true — toggle should appear checked
    const toggle = screen.getByTestId('user-dict-toggle-user-1') as HTMLInputElement;
    expect(toggle.checked).toBe(true);
    fireEvent.click(toggle);
    await waitFor(() => {
      expect((screen.getByTestId('user-dict-toggle-user-1') as HTMLInputElement).checked).toBe(
        false,
      );
    });
  });

  test('translation field source controls include translator and dictionary routes', () => {
    render(<AITranslatePanel />);

    const dropdown = screen.getByTestId('translation-field-source-translation');
    expect(dropdown).toBeTruthy();
    expect(
      (dropdown as HTMLSelectElement).querySelector('option[value="translator"]'),
    ).toBeTruthy();
    expect(
      (dropdown as HTMLSelectElement).querySelector('option[value="dictionary"]'),
    ).toBeTruthy();
  });

  test('preserves saved translator translation source and provider on mount', () => {
    stableSettings.globalReadSettings.contextTranslation.fieldSources = {
      translation: 'translator',
      contextualMeaning: 'ai',
      examples: 'ai',
      grammarHint: 'ai',
    };
    stableSettings.globalReadSettings.translationProvider = 'google';

    render(<AITranslatePanel />);

    expect(
      (screen.getByTestId('translation-field-source-translation') as HTMLSelectElement).value,
    ).toBe('translator');
    expect((screen.getByTestId('translation-provider-select') as HTMLSelectElement).value).toBe(
      'google',
    );
    expect(setSettingsMock).not.toHaveBeenCalled();
    expect(saveSettingsMock).not.toHaveBeenCalled();
  });

  test('changing translation provider persists translator routing and provider selection', async () => {
    render(<AITranslatePanel />);

    fireEvent.change(screen.getByTestId('translation-provider-select'), {
      target: { value: 'deepl' },
    });

    await waitFor(() => expect(saveSettingsMock).toHaveBeenCalled());

    const savedSettings = saveSettingsMock.mock.calls.at(-1)?.[1] as typeof stableSettings;
    expect(savedSettings.globalReadSettings.translationProvider).toBe('deepl');
    expect(savedSettings.globalReadSettings.contextTranslation.fieldSources.translation).toBe(
      'translator',
    );
  });

  test('changing example field source persists non-ai routing', async () => {
    render(<AITranslatePanel />);

    fireEvent.change(screen.getByTestId('translation-field-source-examples'), {
      target: { value: 'corpus' },
    });

    await waitFor(() => expect(saveSettingsMock).toHaveBeenCalled());

    const savedSettings = saveSettingsMock.mock.calls.at(-1)?.[1] as typeof stableSettings;
    expect(savedSettings.globalReadSettings.contextTranslation.fieldSources.examples).toBe(
      'corpus',
    );
  });

  test('importing a dictionary persists a single metadata entry', async () => {
    const { importUserDictionary } =
      await import('@/services/contextTranslation/dictionaryService');
    vi.mocked(importUserDictionary).mockResolvedValue({
      id: 'user-imported',
      name: 'TestDict',
      language: 'zh-TW',
      targetLanguage: 'zh-TW',
      entryCount: 123,
      source: 'user',
      importedAt: 1_900_000_000,
      enabled: true,
    });

    const { container } = render(<AITranslatePanel />);
    const fileInput = container.querySelector('input[type="file"]') as HTMLInputElement | null;
    expect(fileInput).not.toBeNull();

    const file = new File(['dummy'], 'trad-zh-zh.zip', { type: 'application/zip' });
    Object.defineProperty(fileInput!, 'files', { value: [file] });
    fireEvent.change(fileInput!);

    const modalTitle = await screen.findByText('Import Dictionary');
    const modal = modalTitle.closest('.modal-box') as HTMLElement | null;
    expect(modal).not.toBeNull();

    const sourceSelect = modal?.querySelectorAll('select')[0] as HTMLSelectElement | undefined;
    expect(sourceSelect).toBeTruthy();
    fireEvent.change(sourceSelect!, { target: { value: 'zh-TW' } });

    const importButton = screen.getByRole('button', { name: 'Import' }) as HTMLButtonElement;
    await waitFor(() => expect(importButton.disabled).toBe(false));
    fireEvent.click(importButton);

    await waitFor(() => expect(saveSettingsMock).toHaveBeenCalled());

    const savedSettings = saveSettingsMock.mock.calls.at(-1)?.[1] as typeof stableSettings;
    expect(savedSettings.userDictionaryMeta).toHaveLength(2);
    expect(
      savedSettings.userDictionaryMeta.filter((dict) => dict.id === 'user-imported'),
    ).toHaveLength(1);
  });

  test('does not render the old harness controls', () => {
    render(<AITranslatePanel />);

    expect(screen.queryByText('Production only')).toBeNull();
    expect(screen.queryByTestId('advanced-harness-summary')).toBeNull();
    expect(screen.queryByTestId('harness-json-textarea')).toBeNull();
  });

  test('old harness preset actions are no longer rendered', async () => {
    render(<AITranslatePanel />);

    expect(screen.queryByTestId('load-harness-preset')).toBeNull();
    expect(screen.queryByTestId('export-harness-json')).toBeNull();
    expect(screen.queryByTestId('harness-preset-select')).toBeNull();
  });
});

describe('LangPanel', () => {
  afterEach(() => {
    cleanup();
  });

  test('Language tab does not contain the inline Translation section (moved to AITranslatePanel)', async () => {
    // Use importActual to get the real LangPanel (bypassing the module-level mock)
    const { default: RealLangPanel } = await vi.importActual<{
      default: React.ComponentType<{ bookKey: string; onRegisterReset: (fn: () => void) => void }>;
    }>('@/components/settings/LangPanel');

    render(<RealLangPanel bookKey='test' onRegisterReset={() => {}} />);

    // Inline translation section was removed from LangPanel (it now lives in AITranslatePanel)
    const translationSection = document.querySelector(
      '[data-setting-id="settings.language.translationEnabled"]',
    );
    expect(translationSection).toBeNull();

    // AI context-translation section should also NOT be in LangPanel (it lives in AIPanel)
    const aiTranslationSection = document.querySelector(
      '[data-setting-id="settings.ai.contextTranslation"]',
    );
    expect(aiTranslationSection).toBeNull();
  });
});
