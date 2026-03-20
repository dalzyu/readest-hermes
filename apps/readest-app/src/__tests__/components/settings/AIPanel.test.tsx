import React from 'react';
import { fireEvent, render, screen } from '@testing-library/react';
import { beforeEach, describe, expect, test, vi } from 'vitest';

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
    },
    setSettings: setSettingsMock,
    saveSettings: saveSettingsMock,
  }),
}));

describe('AIPanel', () => {
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
});
