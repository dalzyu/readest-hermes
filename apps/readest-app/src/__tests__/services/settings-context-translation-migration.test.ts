import { describe, expect, test } from 'vitest';

import { migrateContextTranslationSource } from '@/services/settingsService';
import { DEFAULT_CONTEXT_TRANSLATION_SETTINGS } from '@/services/contextTranslation/defaults';
import type { SystemSettings } from '@/types/settings';

function makeSettings(overrides?: Partial<SystemSettings>): SystemSettings {
  return {
    ...({} as SystemSettings),
    ...overrides,
    globalReadSettings: {
      ...({} as SystemSettings['globalReadSettings']),
      ...(overrides?.globalReadSettings ?? {}),
    },
  } as SystemSettings;
}

describe('migrateContextTranslationSource', () => {
  test('moves legacy source=dictionary into fieldSources.translation', () => {
    const settings = makeSettings({
      globalReadSettings: {
        contextTranslation: {
          ...DEFAULT_CONTEXT_TRANSLATION_SETTINGS,
          source: 'dictionary',
          fieldSources: undefined,
        },
      } as SystemSettings['globalReadSettings'],
    });

    migrateContextTranslationSource(settings);

    expect(settings.globalReadSettings.contextTranslation?.fieldSources?.translation).toBe(
      'dictionary',
    );
    expect(settings.globalReadSettings.contextTranslation?.source).toBeUndefined();
  });

  test('does not overwrite explicit fieldSources.translation', () => {
    const settings = makeSettings({
      globalReadSettings: {
        contextTranslation: {
          ...DEFAULT_CONTEXT_TRANSLATION_SETTINGS,
          source: 'dictionary',
          fieldSources: {
            translation: 'translator',
            contextualMeaning: 'dictionary',
            examples: 'corpus',
            grammarHint: 'ai',
          },
        },
      } as SystemSettings['globalReadSettings'],
    });

    migrateContextTranslationSource(settings);

    expect(settings.globalReadSettings.contextTranslation?.fieldSources?.translation).toBe(
      'translator',
    );
  });
});
