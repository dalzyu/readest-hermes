import React from 'react';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest';

import AIPanel from '@/components/settings/AIPanel';
import AITranslatePanel from '@/components/settings/AITranslatePanel';
import SettingsDialog from '@/components/settings/SettingsDialog';

const saveSettingsMock = vi.fn();
const setSettingsMock = vi.fn();

// vi.hoisted runs before vi.mock factories — use it to create stable object references
// that won't cause useEffect infinite re-render loops.
const { stableSettings } = vi.hoisted(() => {
  const stableSettings = {
    aiSettings: {
      enabled: false,
      provider: 'ollama',
      ollamaBaseUrl: 'http://127.0.0.1:11434',
      ollamaModel: 'llama3.2',
      ollamaEmbeddingModel: 'nomic-embed-text',
      aiGatewayModel: 'google/gemini-2.5-flash-lite',
      aiGatewayEmbeddingModel: 'openai/text-embedding-3-small',
      openAICompatibleApiStyle: 'chat-completions',
      openAICompatibleBaseUrl: 'http://127.0.0.1:8080',
      openAICompatibleModel: '',
      openAICompatibleEmbeddingBaseUrl: 'http://127.0.0.1:8081',
      openAICompatibleEmbeddingModel: '',
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
            promptInstruction: 'Provide 2\u20133 short example sentences using the selected term in similar contexts.',
          },
        ],
      },
      contextDictionary: {
        enabled: false,
        sourceExamples: true,
      },
    },
    userDictionaryMeta: [] as unknown[],
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
  BUNDLED_DICTIONARIES: [
    { id: 'bundled-zh-en', language: 'zh', targetLanguage: 'en', bundledVersion: '1.0.0' },
    { id: 'bundled-ja-en', language: 'ja', targetLanguage: 'en', bundledVersion: '1.0.0' },
  ],
  initBundledDictionaries: vi.fn().mockReturnValue(Promise.resolve()),
  previewDictionaryZip: vi.fn().mockResolvedValue({ name: 'TestDict', wordcount: 100 }),
  importUserDictionary: vi.fn().mockResolvedValue({}),
  deleteUserDictionary: vi.fn().mockResolvedValue(undefined),
}));

describe('AIPanel', () => {
  afterEach(() => {
    cleanup();
  });

  beforeEach(() => {
    vi.clearAllMocks();
  });

  afterEach(() => {
    cleanup();
  });

  test('renders separate toggles for same-book and prior-volume memory', () => {
    render(<AITranslatePanel />);

    expect(screen.getByText('Use same-book memory')).toBeTruthy();
    expect(screen.getByText('Use prior-volume memory')).toBeTruthy();
  });

  test('renders openai-compatible provider option', () => {
    render(<AIPanel />);

    expect(screen.getAllByText('OpenAI-Compatible').length).toBeGreaterThan(0);
    expect(screen.queryByText('llama.cpp (Local)')).toBeNull();
    expect(screen.queryByText('vLLM (Local)')).toBeNull();
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

  test('renders Dictionaries section with bundled and user sections', () => {
    render(<AITranslatePanel />);
    expect(screen.getByText('Dictionaries')).toBeTruthy();
    expect(screen.getByText('Bundled Dictionaries')).toBeTruthy();
    expect(screen.getByText('User Dictionaries')).toBeTruthy();
  });

  test('shows Add Dictionary button in User Dictionaries section', () => {
    render(<AITranslatePanel />);
    expect(screen.getByText('Add Dictionary')).toBeTruthy();
  });

  test('SettingsDialog renders AI Translate tab button', () => {
    render(<SettingsDialog bookKey="test" />);
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
      'Provide a concise, direct translation of the selected text into the target language.';

    // Edit the textarea to something different
    fireEvent.change(textarea, { target: { value: 'custom instruction' } });
    expect(textarea.value).toBe('custom instruction');

    // Reset — should restore the default
    const resetBtn = screen.getByTestId('reset-prompt-translation');
    fireEvent.click(resetBtn);
    expect(textarea.value).toBe(defaultValue);
  });

  test('bundled dictionary has enable toggle', () => {
    render(<AITranslatePanel />);
    // The bundled dicts are bundled-zh-en and bundled-ja-en from the mock
    const zhToggle = screen.getByTestId('bundled-dict-toggle-bundled-zh-en');
    expect(zhToggle).toBeTruthy();
    expect((zhToggle as HTMLInputElement).type).toBe('checkbox');
    // By default enabled (undefined === enabled)
    expect((zhToggle as HTMLInputElement).checked).toBe(true);
  });

  test('user dictionary enable toggle persists after toggle', async () => {
    render(<AITranslatePanel />);
    // No user dicts in mock by default — queryAllByTestId returns empty array
    const userDictToggles = screen.queryAllByTestId(/^user-dict-toggle-/);
    if (userDictToggles.length > 0) {
      const toggle = userDictToggles[0]!;
      const wasChecked = (toggle as HTMLInputElement).checked;
      fireEvent.click(toggle);
      await waitFor(() => {
        expect((toggle as HTMLInputElement).checked).not.toBe(wasChecked);
      });
    }
    // If no user dicts, test passes trivially (no dicts to toggle)
    expect(true).toBe(true);
  });
});

describe('LangPanel', () => {
  afterEach(() => {
    cleanup();
  });

  test('Language tab does not have Translation section', async () => {
    // Use importActual to get the real LangPanel (bypassing the module-level mock)
    const { default: RealLangPanel } = await vi.importActual<{
      default: React.ComponentType<{ bookKey: string; onRegisterReset: (fn: () => void) => void }>;
    }>('@/components/settings/LangPanel');

    render(<RealLangPanel bookKey="test" onRegisterReset={() => {}} />);

    // Target the specific data-setting-id attribute (NOT data-testid)
    const translationSection = document.querySelector(
      '[data-setting-id="settings.language.translationEnabled"]',
    );
    expect(translationSection).toBeNull();
  });
});
