import { beforeEach, describe, expect, test, vi } from 'vitest';

import type {
  TranslationOutputField,
  TranslationRequest,
} from '@/services/contextTranslation/types';

vi.mock('@/services/contextTranslation/llmClient', () => ({
  callLLM: vi.fn(),
  streamLLM: vi.fn(),
}));

import { callLLM, streamLLM } from '@/services/contextTranslation/llmClient';
import {
  streamTranslationWithContext,
  streamLookupWithContext,
  translateWithContext,
} from '@/services/contextTranslation/translationService';
import type { ContextLookupMode } from '@/services/contextTranslation/modes';

const mockCallLLM = vi.mocked(callLLM);
const mockStreamLLM = vi.mocked(streamLLM);

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
];

const fieldsWithExamples: TranslationOutputField[] = [
  ...fields,
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
    localFutureBuffer: 'The next line clarifies the bond.',
    sameBookChunks: ['Earlier in the same volume, 知己 described a sworn confidant.'],
    priorVolumeChunks: ['Volume 1 used 知己 during a reunion scene.'],
    retrievalStatus: 'cross-volume',
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
  vi.clearAllMocks();
});

describe('translateWithContext', () => {
  test('calls LLM with built prompts and returns parsed result', async () => {
    mockCallLLM.mockResolvedValueOnce(
      '<translation>close friend</translation>\n<contextualMeaning>A soulmate who truly understands you.</contextualMeaning>',
    );

    const result = await translateWithContext(baseRequest);

    expect(mockCallLLM).toHaveBeenCalledOnce();
    const [systemPrompt, userPrompt] = mockCallLLM.mock.calls[0]!;
    expect(systemPrompt).toContain('English');
    expect(userPrompt).toContain('知己');
    expect(userPrompt).toContain('Earlier in the same volume');

    expect(result['translation']).toBe('close friend');
    expect(result['contextualMeaning']).toBe('A soulmate who truly understands you.');
  });

  test('returns empty translation when LLM returns empty string', async () => {
    mockCallLLM.mockResolvedValueOnce('');

    const result = await translateWithContext(baseRequest);

    expect(result['translation']).toBe('');
  });

  test('propagates LLM errors', async () => {
    mockCallLLM.mockRejectedValueOnce(new Error('Network error'));

    await expect(translateWithContext(baseRequest)).rejects.toThrow('Network error');
  });

  test('adds deterministic pinyin to chinese examples', async () => {
    mockCallLLM.mockResolvedValueOnce(
      '<translation>kindred spirit</translation><examples>1. 知己难逢\nEnglish: True friends are hard to find.</examples>',
    );

    const result = await translateWithContext({
      ...baseRequest,
      sourceLanguage: 'zh',
      outputFields: fieldsWithExamples,
    });

    expect(result['examples']).toBe(
      '1. 知己难逢\nPinyin: zhī jǐ nán féng\nEnglish: True friends are hard to find.',
    );
  });
});

describe('streamTranslationWithContext', () => {
  test('streams partial field updates in order', async () => {
    mockStreamLLM.mockImplementation(async function* () {
      yield '<translation>close';
      yield ' friend</translation><contextualMeaning>trusted ally';
      yield '</contextualMeaning>';
    });

    const updates = [];

    for await (const update of streamTranslationWithContext(baseRequest, 'mock-model' as never)) {
      updates.push(update);
    }

    expect(updates[0]!.fields['translation']).toBe('close');
    expect(updates[1]!.fields['translation']).toBe('close friend');
    expect(updates[1]!.fields['contextualMeaning']).toBe('trusted ally');
    expect(updates.at(-1)!.done).toBe(true);
    expect(updates.at(-1)!.fields['contextualMeaning']).toBe('trusted ally');
  });

  test('streams dictionary fields simpleDefinition and contextualMeaning in real-time', async () => {
    mockStreamLLM.mockImplementation(async function* () {
      yield '<simpleDefinition>A close confidant';
      yield '</simpleDefinition><contextualMeaning>In this passage, a trusted ally';
      yield '</contextualMeaning>';
    });

    const updates: { fields: Record<string, string>; activeFieldId: string | null }[] = [];

    for await (const chunk of streamLookupWithContext(
      { ...baseRequest, mode: 'dictionary' as ContextLookupMode },
      'mock-model' as never,
    )) {
      updates.push(chunk);
    }

    // simpleDefinition must stream in real-time, not wait for final parse
    expect(updates[0]!.fields['simpleDefinition']).toBe('A close confidant');
    expect(updates[0]!.activeFieldId).toBe('simpleDefinition');
    // contextualMeaning should also appear during streaming
    const finalUpdate = updates.at(-2)!; // last streaming chunk before final
    expect(finalUpdate.fields['contextualMeaning']).toContain('trusted ally');
  });

  test('streams chinese examples with deterministic pinyin', async () => {
    mockStreamLLM.mockImplementation(async function* () {
      yield '<translation>kindred spirit</translation><examples>1. 知己难逢';
      yield '\nEnglish: True friends are hard to find.</examples>';
    });

    const updates = [];

    for await (const update of streamTranslationWithContext(
      {
        ...baseRequest,
        sourceLanguage: 'zh',
        outputFields: fieldsWithExamples,
      },
      'mock-model' as never,
    )) {
      updates.push(update);
    }

    expect(updates[0]!.fields['examples']).toBe('1. 知己难逢\nPinyin: zhī jǐ nán féng');
    expect(updates.at(-1)!.fields['examples']).toBe(
      '1. 知己难逢\nPinyin: zhī jǐ nán féng\nEnglish: True friends are hard to find.',
    );
  });
});
