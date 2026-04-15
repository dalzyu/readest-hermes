import { beforeEach, describe, expect, test, vi } from 'vitest';

import type {
  TranslationOutputField,
  TranslationRequest,
} from '@/services/contextTranslation/types';
import { resolveContextTranslationHarnessSettings } from '@/services/contextTranslation/defaults';

vi.mock('@/services/contextTranslation/llmClient', () => ({
  callLLM: vi.fn(),
  streamLLM: vi.fn(),
}));

import { callLLM } from '@/services/contextTranslation/llmClient';
import { translateWithContext } from '@/services/contextTranslation/translationService';

const mockCallLLM = vi.mocked(callLLM);

const fields: TranslationOutputField[] = [
  {
    id: 'translation',
    label: 'Translation',
    enabled: true,
    order: 0,
    promptInstruction: 'Provide a direct translation.',
  },
  {
    id: 'contextualMeaning',
    label: 'Contextual Meaning',
    enabled: true,
    order: 1,
    promptInstruction: 'Explain contextual meaning.',
  },
  {
    id: 'examples',
    label: 'Usage Examples',
    enabled: true,
    order: 2,
    promptInstruction: 'Give usage examples.',
  },
];

const baseRequest: TranslationRequest = {
  selectedText: '知己',
  popupContext: {
    localPastContext: 'He had finally found a true 知己.',
    localFutureBuffer: 'The next line deepens the bond.',
    sameBookChunks: ['Earlier passage mentioning 知己.'],
    priorVolumeChunks: [],
    retrievalStatus: 'local-volume',
    retrievalHints: {
      currentVolumeIndexed: true,
      missingLocalIndex: false,
      missingPriorVolumes: [],
      missingSeriesAssignment: false,
    },
    dictionaryEntries: [],
  },
  targetLanguage: 'en',
  outputFields: fields,
};

beforeEach(() => {
  mockCallLLM.mockReset();
});

describe('harness LLM call budget (maxTotalLLMCalls)', () => {
  test('with maxTotalLLMCalls=1, only initial call is made even if repair is wanted', async () => {
    // Contaminated response, but budget allows only 1 call
    mockCallLLM.mockResolvedValueOnce(
      '<translation>Thinking Process:\nclose friend</translation>\n' +
        '<contextualMeaning>A soulmate.</contextualMeaning>',
    );

    await translateWithContext({
      ...baseRequest,
      harness: { maxTotalLLMCalls: 1 },
    });

    expect(mockCallLLM).toHaveBeenCalledTimes(1);
  });

  test('with maxTotalLLMCalls=3 (default), harness stops after 3 calls even if rescue wanted more', async () => {
    // Call 1 (initial): contaminated → triggers repair
    // Call 2 (repair): still contaminated → triggers per-field rescue
    // Call 3 (rescue field 1): clean → budget exhausted, remaining fields skipped
    mockCallLLM
      .mockResolvedValueOnce('<contextualMeaning>Too vague.</contextualMeaning>')
      .mockResolvedValueOnce('<contextualMeaning>Still missing translation.</contextualMeaning>')
      .mockResolvedValueOnce('close friend');

    const result = await translateWithContext({
      ...baseRequest,
    });

    // Default maxTotalLLMCalls=3 caps the cascade
    expect(mockCallLLM).toHaveBeenCalledTimes(3);
    expect(result['translation']).toBe('close friend');
  });

  test('with maxTotalLLMCalls=5, full per-field rescue runs for all 3 fields', async () => {
    // Call 1 (initial): missing primary
    // Call 2 (repair): still missing primary
    // Calls 3-5 (per-field rescue): one per enabled field
    mockCallLLM
      .mockResolvedValueOnce('<contextualMeaning>Too vague.</contextualMeaning>')
      .mockResolvedValueOnce('<contextualMeaning>Still missing translation.</contextualMeaning>')
      .mockResolvedValueOnce('close friend')
      .mockResolvedValueOnce('A soulmate who truly understands you.')
      .mockResolvedValueOnce('He remained a close friend through the crisis.');

    const result = await translateWithContext({
      ...baseRequest,
      harness: { maxTotalLLMCalls: 5 },
    });

    expect(mockCallLLM).toHaveBeenCalledTimes(5);
    expect(result['translation']).toBe('close friend');
    expect(result['contextualMeaning']).toBe('A soulmate who truly understands you.');
    expect(result['examples']).toBe('He remained a close friend through the crisis.');
  });

  test('legacy single-pass harness settings normalize to production', () => {
    expect(resolveContextTranslationHarnessSettings({ flow: 'single-pass' as never }).flow).toBe(
      'production',
    );
  });

  test('repair disabled limits to 1 call even with production flow and budget', async () => {
    mockCallLLM.mockResolvedValueOnce(
      '<translation>Thinking Process:\nclose friend</translation>\n' +
        '<contextualMeaning>A soulmate.</contextualMeaning>',
    );

    await translateWithContext({
      ...baseRequest,
      harness: {
        flow: 'production',
        repairEnabled: false,
        perFieldRescueEnabled: false,
        maxTotalLLMCalls: 10,
      },
    });

    expect(mockCallLLM).toHaveBeenCalledTimes(1);
  });

  test('per-field rescue repair retries count toward total budget', async () => {
    // Budget = 7, 3 fields. Flow:
    // Call 1 (initial): missing primary
    // Call 2 (repair): still missing
    // Call 3 (rescue translation): contaminated
    // Call 4 (rescue translation retry): clean
    // Call 5 (rescue contextualMeaning): clean
    // Call 6 (rescue examples): clean
    // Total: 6 calls within budget of 7
    mockCallLLM
      .mockResolvedValueOnce('<contextualMeaning>vague</contextualMeaning>')
      .mockResolvedValueOnce('<contextualMeaning>still no translation</contextualMeaning>')
      .mockResolvedValueOnce('Thinking Process:\nclose friend')
      .mockResolvedValueOnce('close friend')
      .mockResolvedValueOnce('A soulmate who truly understands you.')
      .mockResolvedValueOnce('He remained a close friend.');

    const result = await translateWithContext({
      ...baseRequest,
      harness: { maxTotalLLMCalls: 7 },
    });

    expect(mockCallLLM).toHaveBeenCalledTimes(6);
    expect(result['translation']).toBe('close friend');
    expect(result['contextualMeaning']).toBe('A soulmate who truly understands you.');
    expect(result['examples']).toBe('He remained a close friend.');
  });
});
