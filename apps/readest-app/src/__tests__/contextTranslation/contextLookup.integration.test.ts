import { beforeEach, describe, expect, test, vi } from 'vitest';

vi.mock('@/services/contextTranslation/llmClient', () => ({
  callLLM: vi.fn(),
}));

vi.mock('@/utils/telemetry', () => ({
  captureEvent: vi.fn(),
}));

import { callLLM } from '@/services/contextTranslation/llmClient';
import { runContextLookup } from '@/services/contextTranslation/contextLookupService';
import { DEFAULT_CONTEXT_TRANSLATION_SETTINGS } from '@/services/contextTranslation/defaults';
import type { PopupContextBundle } from '@/services/contextTranslation/types';

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
});
