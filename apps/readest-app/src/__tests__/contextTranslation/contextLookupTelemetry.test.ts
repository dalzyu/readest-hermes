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
import { captureEvent } from '@/utils/telemetry';

const popupContext: PopupContextBundle = {
  localPastContext: 'He had finally found a true friend.',
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

describe('context lookup telemetry', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  test('records accept decisions with plugin resolution metadata', async () => {
    vi.mocked(callLLM).mockResolvedValueOnce(
      '<lookup_json>{"translation":"close friend","contextualMeaning":"a trusted companion"}</lookup_json>',
    );

    const result = await runContextLookup({
      mode: 'translation',
      selectedText: '知己',
      popupContext,
      targetLanguage: 'en',
      outputFields: DEFAULT_CONTEXT_TRANSLATION_SETTINGS.outputFields,
    });

    expect(result.validationDecision).toBe('accept');
    expect(captureEvent).toHaveBeenCalledWith(
      'context_lookup_outcome',
      expect.objectContaining({
        mode: 'translation',
        decision: 'accept',
        repairCount: 0,
        degradationPath: 'none',
        sourcePlugin: 'zh',
        targetPlugin: 'en',
      }),
    );
  });

  test('records repair recovery when the first response degrades', async () => {
    vi.mocked(callLLM)
      .mockResolvedValueOnce('<lookup_json>{"translation":""}</lookup_json>')
      .mockResolvedValueOnce(
        '<lookup_json>{"translation":"friend","contextualMeaning":"someone close"}</lookup_json>',
      );

    const result = await runContextLookup({
      mode: 'translation',
      selectedText: 'ami',
      popupContext,
      targetLanguage: 'en',
      outputFields: DEFAULT_CONTEXT_TRANSLATION_SETTINGS.outputFields,
    });

    expect(result.validationDecision).toBe('accept');
    expect(callLLM).toHaveBeenCalledTimes(2);
    expect(captureEvent).toHaveBeenCalledWith(
      'context_lookup_outcome',
      expect.objectContaining({
        decision: 'accept',
        repairCount: 1,
        degradationPath: 'repair-recovered',
      }),
    );
  });

  test('records repair failure when degraded output cannot be repaired', async () => {
    vi.mocked(callLLM)
      .mockResolvedValueOnce('<lookup_json>{"translation":""}</lookup_json>')
      .mockResolvedValueOnce('<lookup_json>{"translation":""}</lookup_json>');

    const result = await runContextLookup({
      mode: 'translation',
      selectedText: 'term',
      popupContext,
      targetLanguage: 'fr',
      outputFields: DEFAULT_CONTEXT_TRANSLATION_SETTINGS.outputFields,
    });

    expect(result.validationDecision).toBe('degrade');
    expect(captureEvent).toHaveBeenCalledWith(
      'context_lookup_outcome',
      expect.objectContaining({
        decision: 'degrade',
        repairCount: 1,
        degradationPath: 'repair-failed',
      }),
    );
  });
});
