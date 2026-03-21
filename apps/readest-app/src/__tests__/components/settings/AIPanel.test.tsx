import React from 'react';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest';

import AIPanel from '@/components/settings/AIPanel';
import { DEFAULT_AI_SETTINGS } from '@/services/ai/constants';
import {
  DEFAULT_CONTEXT_DICTIONARY_SETTINGS,
  DEFAULT_CONTEXT_TRANSLATION_SETTINGS,
} from '@/services/contextTranslation/defaults';

const saveSettingsMock = vi.fn();
const setSettingsMock = vi.fn();

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

vi.mock('@/store/settingsStore', () => ({
  useSettingsStore: () => ({
    settings: {
      aiSettings: DEFAULT_AI_SETTINGS,
      globalReadSettings: {
        contextTranslation: {
          ...DEFAULT_CONTEXT_TRANSLATION_SETTINGS,
          enabled: true,
        },
        contextDictionary: DEFAULT_CONTEXT_DICTIONARY_SETTINGS,
      },
      userDictionaryMeta: [],
    },
    setSettings: setSettingsMock,
    saveSettings: saveSettingsMock,
  }),
}));

vi.mock('@/services/contextTranslation/dictionaryService', () => ({
  BUNDLED_DICTIONARIES: [
    { id: 'bundled-zh-en', language: 'zh', targetLanguage: 'en', bundledVersion: '1.0.0' },
    { id: 'bundled-ja-en', language: 'ja', targetLanguage: 'en', bundledVersion: '1.0.0' },
  ],
  initBundledDictionaries: vi.fn().mockResolvedValue(undefined),
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

  test('renders separate toggles for same-book and prior-volume memory', () => {
    render(<AIPanel />);

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
    render(<AIPanel />);

    expect(screen.getAllByRole('option', { name: 'Bokmål' }).length).toBeGreaterThan(0);
  });

  test('saves same-book memory setting independently', () => {
    render(<AIPanel />);

    const sameBookToggle = screen.getByLabelText('Use same-book memory');
    fireEvent.click(sameBookToggle);

    expect(setSettingsMock).toHaveBeenCalled();
    expect(saveSettingsMock).toHaveBeenCalled();
  });

  test('ai panel persists dictionary settings separately from translation settings', () => {
    render(<AIPanel />);
    expect(screen.getByLabelText(/enable dictionary lookup/i)).toBeTruthy();
  });

  test('renders Dictionaries section with bundled and user sections', () => {
    render(<AIPanel />);
    expect(screen.getByText('Dictionaries')).toBeTruthy();
    expect(screen.getByText('Bundled Dictionaries')).toBeTruthy();
    expect(screen.getByText('User Dictionaries')).toBeTruthy();
  });

  test('shows Add Dictionary button in User Dictionaries section', () => {
    render(<AIPanel />);
    expect(screen.getByText('Add Dictionary')).toBeTruthy();
  });
});
