import { describe, expect, test, vi, beforeEach } from 'vitest';

vi.mock('@/services/contextTranslation/llmClient', () => ({
  callLLM: vi.fn(),
}));

import { callLLM } from '@/services/contextTranslation/llmClient';
import { runContextLookup } from '@/services/contextTranslation/contextLookupService';
import type { PopupContextBundle } from '@/services/contextTranslation/types';
import { DEFAULT_CONTEXT_TRANSLATION_SETTINGS } from '@/services/contextTranslation/defaults';

const popupContext: PopupContextBundle = {
  localPastContext: 'He had finally found a true 知己.',
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

beforeEach(() => {
  vi.mocked(callLLM).mockResolvedValue(
    '<lookup_json>{"translation":"close friend","contextualMeaning":"a trusted companion"}</lookup_json>',
  );
});

describe('runContextLookup', () => {
  test('shared lookup service detects language, builds prompts, validates, and returns normalized output', async () => {
    const result = await runContextLookup({
      mode: 'translation',
      selectedText: '知己',
      popupContext,
      targetLanguage: 'en',
      outputFields: DEFAULT_CONTEXT_TRANSLATION_SETTINGS.outputFields,
    });
    expect(result.fields['translation']).toBe('close friend');
    expect(result.validationDecision).toBe('accept');
  });

  test('includes detected source language info', async () => {
    const result = await runContextLookup({
      mode: 'translation',
      selectedText: '知己',
      popupContext,
      targetLanguage: 'en',
      outputFields: DEFAULT_CONTEXT_TRANSLATION_SETTINGS.outputFields,
    });
    expect(result.detectedLanguage).toBeDefined();
    expect(result.detectedLanguage.language).toBeDefined();
  });
});
