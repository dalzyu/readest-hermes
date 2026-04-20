import { gzipSync } from 'fflate';
import { beforeEach, describe, expect, test, vi } from 'vitest';

const records = new Map<string, unknown>();
const settingsRef = { current: [] as UserDictionary[] };

vi.mock('@/services/ai/storage/aiStore', () => ({
  aiStore: {
    async putRecord(_store: string, record: unknown) {
      records.set((record as { id: string }).id, record);
    },
    async getRecord(_store: string, id: string) {
      return records.get(id) ?? null;
    },
    async deleteRecord(_store: string, id: string) {
      records.delete(id);
    },
  },
}));

vi.mock('@/store/settingsStore', () => ({
  useSettingsStore: Object.assign(() => ({}), {
    getState: () => ({
      settings: {
        get userDictionaryMeta() {
          return settingsRef.current;
        },
      },
      setSettings: vi.fn(),
    }),
    set: vi.fn(),
    subscribe: () => () => {},
  }),
}));

vi.mock('@/utils/simplecc', () => ({
  initSimpleCC: vi.fn().mockResolvedValue(undefined),
  runSimpleCC: vi.fn((text: string, variant: string) => {
    if (variant === 's2t' && text === '一丁不识') return '一丁不識';
    return text;
  }),
}));

vi.mock('@/services/contextTranslation/plugins/jpTokenizer', () => ({
  getDictionaryForm: vi.fn((text: string) => text),
  getReadingRomaji: vi.fn(() => null),
  initJapaneseTokenizer: vi.fn().mockResolvedValue(undefined),
  isTokenizerReady: vi.fn(() => false),
}));

vi.mock('@/services/contextTranslation/llmClient', () => ({
  callLLM: vi.fn(),
}));

vi.mock('@/utils/telemetry', () => ({
  captureEvent: vi.fn(),
}));

import { callLLM } from '@/services/contextTranslation/llmClient';
import { runContextLookup } from '@/services/contextTranslation/contextLookupService';
import { DEFAULT_CONTEXT_TRANSLATION_SETTINGS } from '@/services/contextTranslation/defaults';
import type { PopupContextBundle, UserDictionary } from '@/services/contextTranslation/types';

const popupContext: PopupContextBundle = {
  localPastContext: 'A compact bit of local context.',
  localFutureBuffer: '',
  sameBookChunks: [],
  priorVolumeChunks: [],
  dictionaryEntries: [],
  retrievalStatus: 'local-only',
  retrievalHints: {
    currentVolumeIndexed: true,
    missingLocalIndex: false,
    missingPriorVolumes: [],
    missingSeriesAssignment: false,
  },
};

function storeDictionaryRecord(
  meta: UserDictionary,
  entries: Array<{ headword: string; definition: string }>,
) {
  records.set(meta.id, {
    id: meta.id,
    meta,
    blob: gzipSync(new TextEncoder().encode(JSON.stringify(entries))),
  });
}

type Scenario = {
  selectedText: string;
  sourceLanguage?: string;
  targetLanguage: string;
  response: string;
};

async function runScenario({ selectedText, sourceLanguage, targetLanguage, response }: Scenario) {
  vi.mocked(callLLM).mockResolvedValueOnce(response);

  const result = await runContextLookup({
    mode: 'translation',
    selectedText,
    sourceLanguage,
    popupContext,
    targetLanguage,
    outputFields: DEFAULT_CONTEXT_TRANSLATION_SETTINGS.outputFields,
  });

  return {
    ok: result.validationDecision !== 'degrade',
    decision: result.validationDecision,
    detectedLanguage: result.detectedLanguage,
    translation: result.fields['translation'],
  };
}

describe('context lookup integration scenarios', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    records.clear();
    settingsRef.current = [];
  });

  test.each([
    [
      'en',
      'zh-Hans',
      {
        selectedText: 'friend',
        targetLanguage: 'zh-Hans',
        response:
          '<lookup_json>{"translation":"朋友","contextualMeaning":"关系亲近的人"}</lookup_json>',
      },
    ],
    [
      'zh-Hans',
      'en',
      {
        selectedText: '知己',
        targetLanguage: 'en',
        response:
          '<lookup_json>{"translation":"close friend","contextualMeaning":"a deeply trusted friend"}</lookup_json>',
      },
    ],
    [
      'ja',
      'fr',
      {
        selectedText: 'こんにちは',
        sourceLanguage: 'ja',
        targetLanguage: 'fr',
        response:
          '<lookup_json>{"translation":"bonjour","contextualMeaning":"salutation courante"}</lookup_json>',
      },
    ],
    [
      'und',
      'en',
      {
        selectedText: '...?!',
        sourceLanguage: 'und',
        targetLanguage: 'en',
        response:
          '<lookup_json>{"translation":"punctuation marks","contextualMeaning":"an emphatic punctuation sequence"}</lookup_json>',
      },
    ],
  ])(
    'handles %s to %s representative lookups',
    async (_sourceLanguage, _targetLanguage, scenario) => {
      await expect(runScenario(scenario)).resolves.toMatchObject({ ok: true });
    },
  );

  test('marks mixed-language selections as mixed without degrading a valid result', async () => {
    const result = await runScenario({
      selectedText: 'hello 世界',
      targetLanguage: 'fr',
      response:
        '<lookup_json>{"translation":"bonjour monde","contextualMeaning":"mélange intentionnel de salutations"}</lookup_json>',
    });

    expect(result.ok).toBe(true);
    expect(result.detectedLanguage.mixed).toBe(true);
  });

  test('handles short-string lookups without degrading valid output', async () => {
    const result = await runScenario({
      selectedText: 'hi',
      targetLanguage: 'es',
      response:
        '<lookup_json>{"translation":"hola","contextualMeaning":"saludo breve e informal"}</lookup_json>',
    });

    expect(result.ok).toBe(true);
    expect(result.detectedLanguage.confidence).toBeLessThanOrEqual(1);
  });

  test('injects locale-tagged traditional dictionary entries into translation prompts', async () => {
    settingsRef.current = [
      {
        id: 'user-zh-tw-zh-tw',
        name: 'Traditional Locale Dict',
        language: 'zh-TW',
        targetLanguage: 'zh-TW',
        entryCount: 1,
        source: 'user',
        importedAt: 1_900_000_000,
        enabled: true,
      },
    ];
    storeDictionaryRecord(settingsRef.current[0]!, [
      {
        headword: '一丁不識',
        definition: '不識一字，形容人不識字或文化程度極低',
      },
    ]);
    vi.mocked(callLLM).mockResolvedValueOnce(
      '<lookup_json>{"translation":"illiterate","contextualMeaning":"someone who cannot read a single character"}</lookup_json>',
    );

    const result = await runContextLookup({
      mode: 'translation',
      selectedText: '一丁不识',
      popupContext,
      sourceLanguage: 'zh',
      targetLanguage: 'en',
      outputFields: DEFAULT_CONTEXT_TRANSLATION_SETTINGS.outputFields,
    });

    const [, userPrompt] = vi.mocked(callLLM).mock.calls.at(-1)!;

    expect(result.validationDecision).toBe('accept');
    expect(userPrompt).toContain('<reference_dictionary>');
    expect(userPrompt).toContain('一丁不識: 不識一字，形容人不識字或文化程度極低');
  });

  test('does not inject weak prefix fallback dictionary entries into translation prompts', async () => {
    settingsRef.current = [
      {
        id: 'user-zh-zh-weak-fallback',
        name: 'Weak Fallback Dict',
        language: 'zh',
        targetLanguage: 'zh',
        entryCount: 1,
        source: 'user',
        importedAt: 1_900_000_001,
        enabled: true,
      },
    ];
    storeDictionaryRecord(settingsRef.current[0]!, [
      {
        headword: '封',
        definition: '疆域；分界',
      },
    ]);
    vi.mocked(callLLM).mockResolvedValueOnce(
      '<lookup_json>{"translation":"titled mage","contextualMeaning":"an elite mage bearing an imperial title"}</lookup_json>',
    );

    await runContextLookup({
      mode: 'translation',
      selectedText: '封号法师',
      popupContext,
      sourceLanguage: 'zh',
      targetLanguage: 'en',
      outputFields: DEFAULT_CONTEXT_TRANSLATION_SETTINGS.outputFields,
    });

    const [, userPrompt] = vi.mocked(callLLM).mock.calls.at(-1)!;

    expect(userPrompt).not.toContain('<reference_dictionary>');
    expect(userPrompt).not.toContain('封:');
  });
});
