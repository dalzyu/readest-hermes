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
  streamLookupWithContext,
  streamTranslationWithContext,
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
  mockCallLLM.mockReset();
  mockStreamLLM.mockReset();
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

  test('falls back to per-field rescue when initial and repair responses miss translation', async () => {
    mockCallLLM
      .mockResolvedValueOnce('<contextualMeaning>Too vague.</contextualMeaning>')
      .mockResolvedValueOnce('<contextualMeaning>Still missing translation.</contextualMeaning>')
      .mockResolvedValueOnce('close friend')
      .mockResolvedValueOnce('A trusted companion in this scene.')
      .mockResolvedValueOnce('He remained a close friend through the crisis.');

    const result = await translateWithContext({
      ...baseRequest,
      outputFields: fieldsWithExamples,
    });

    expect(mockCallLLM).toHaveBeenCalledTimes(5);
    expect(result['translation']).toBe('close friend');
    expect(result['contextualMeaning']).toBe('A trusted companion in this scene.');
    expect(result['examples']).toBe('He remained a close friend through the crisis.');
  });

  test('sanitizes gemma-style reasoning leaked into tagged fields', async () => {
    mockCallLLM
      .mockResolvedValueOnce(
        '<translation>distanciada</translation>\n' +
          '<contextualMeaning>Thinking Process:\n1. Analyze the Request.\n2. Draft the answer.\nLa palabra describe una desconexion emocional irreversible entre la memoria y la realidad presente.</contextualMeaning>\n' +
          '<examples>The user wants me to provide examples.\n1. El lugar le parecia distanciado de sus recuerdos.\n2. La casa se sentia distanciada de todo lo que recordaba.</examples>',
      )
      .mockResolvedValueOnce(
        '<translation>distanciada</translation>\n' +
          '<contextualMeaning>La palabra describe una desconexion emocional irreversible entre la memoria y la realidad presente.</contextualMeaning>\n' +
          '<examples>1. El lugar le parecia distanciado de sus recuerdos.\n2. La casa se sentia distanciada de todo lo que recordaba.</examples>',
      );

    const result = await translateWithContext({
      ...baseRequest,
      sourceLanguage: 'en',
      targetLanguage: 'es',
      outputFields: fieldsWithExamples,
    });

    expect(mockCallLLM).toHaveBeenCalledTimes(2);
    expect(result['translation']).toBe('distanciada');
    expect(result['contextualMeaning']).toBe(
      'La palabra describe una desconexion emocional irreversible entre la memoria y la realidad presente.',
    );
  });

  test('retries when sanitization removes leaked reasoning and leaves the primary field empty', async () => {
    mockCallLLM
      .mockResolvedValueOnce(
        '<translation>Thinking Process:\n1. Analyze the Request.\n2. Pick a Japanese word.</translation>\n' +
          '<contextualMeaning>The user wants me to explain the term in Japanese.</contextualMeaning>',
      )
      .mockResolvedValueOnce(
        '<translation>不安定な</translation>\n<contextualMeaning>この文脈では、足場や心の拠り所を失った不安定さを示す。</contextualMeaning>',
      );

    const result = await translateWithContext({
      ...baseRequest,
      sourceLanguage: 'en',
      targetLanguage: 'ja',
    });

    expect(mockCallLLM).toHaveBeenCalledTimes(2);
    expect(result['translation']).toBe('不安定な');
    expect(result['contextualMeaning']).toBe(
      'この文脈では、足場や心の拠り所を失った不安定さを示す。',
    );
  });

  test('repairs responses that still contain reasoning leakage even when fields are non-empty', async () => {
    mockCallLLM
      .mockResolvedValueOnce(
        '<translation>ajeno</translation>\n' +
          '<contextualMeaning>Thinking Process:\n1. Analyze the Request.\nEl lugar se siente ajeno a la memoria de la protagonista.</contextualMeaning>',
      )
      .mockResolvedValueOnce(
        '<translation>ajeno</translation>\n<contextualMeaning>El lugar se siente ajeno a la memoria de la protagonista.</contextualMeaning>',
      );

    const result = await translateWithContext({
      ...baseRequest,
      sourceLanguage: 'en',
      targetLanguage: 'es',
    });

    expect(mockCallLLM).toHaveBeenCalledTimes(2);
    expect(result['translation']).toBe('ajeno');
    expect(result['contextualMeaning']).toBe(
      'El lugar se siente ajeno a la memoria de la protagonista.',
    );
  });

  test('falls back to per-field rescue when the repaired response still contains reasoning leakage', async () => {
    mockCallLLM
      .mockResolvedValueOnce(
        '<translation>ajeno</translation>\n' +
          '<contextualMeaning>Thinking Process:\n1. Analyze the Request.\nEl lugar se siente ajeno a la memoria de la protagonista.</contextualMeaning>',
      )
      .mockResolvedValueOnce(
        '<translation>Confidence Score: 5/5</translation>\n' +
          '<contextualMeaning>The user wants me to explain the nuance.</contextualMeaning>',
      )
      .mockResolvedValueOnce('ajeno')
      .mockResolvedValueOnce('El lugar se siente ajeno a la memoria de la protagonista.')
      .mockResolvedValueOnce('La casa le parecia ajena a todo recuerdo.');

    const result = await translateWithContext({
      ...baseRequest,
      sourceLanguage: 'en',
      targetLanguage: 'es',
      outputFields: fieldsWithExamples,
    });

    expect(mockCallLLM).toHaveBeenCalledTimes(5);
    expect(result['translation']).toBe('ajeno');
    expect(result['contextualMeaning']).toBe(
      'El lugar se siente ajeno a la memoria de la protagonista.',
    );
    expect(result['examples']).toBe('La casa le parecia ajena a todo recuerdo.');
  });

  test('retries contaminated per-field rescue outputs once with a stricter single-field prompt', async () => {
    mockCallLLM
      .mockResolvedValueOnce(
        '<translation>ajeno</translation>\n' +
          '<contextualMeaning>Thinking Process:\n1. Analyze the Request.\nEl lugar se siente ajeno a la memoria de la protagonista.</contextualMeaning>',
      )
      .mockResolvedValueOnce(
        '<translation>Confidence Score: 5/5</translation>\n' +
          '<contextualMeaning>The user wants me to explain the nuance.</contextualMeaning>',
      )
      .mockResolvedValueOnce('Thinking Process:\n1. Analyze the Request.\najeno')
      .mockResolvedValueOnce('ajeno')
      .mockResolvedValueOnce('The user wants me to explain the nuance.\nEl lugar se siente ajeno a la memoria de la protagonista.')
      .mockResolvedValueOnce('El lugar se siente ajeno a la memoria de la protagonista.')
      .mockResolvedValueOnce('La casa le parecia ajena a todo recuerdo.');

    const result = await translateWithContext({
      ...baseRequest,
      sourceLanguage: 'en',
      targetLanguage: 'es',
      outputFields: fieldsWithExamples,
    });

    expect(mockCallLLM).toHaveBeenCalledTimes(7);
    const repairSystemPrompt = mockCallLLM.mock.calls[3]?.[0];
    const repairUserPrompt = mockCallLLM.mock.calls[3]?.[1];
    expect(repairSystemPrompt).toContain('Original field request');
    expect(repairUserPrompt).toContain('<selected_text>知己</selected_text>');
    expect(repairUserPrompt).toContain('Earlier in the same volume');
    expect(result['translation']).toBe('ajeno');
    expect(result['contextualMeaning']).toBe(
      'El lugar se siente ajeno a la memoria de la protagonista.',
    );
    expect(result['examples']).toBe('La casa le parecia ajena a todo recuerdo.');
  });

  test('sanitizes channel-delimited final content returned by per-field repair', async () => {
    mockCallLLM
      .mockResolvedValueOnce(
        '<translation>ajeno</translation>\n' +
          '<contextualMeaning>Thinking Process:\n1. Analyze the Request.\nEl lugar se siente ajeno a la memoria de la protagonista.</contextualMeaning>',
      )
      .mockResolvedValueOnce(
        '<translation>Confidence Score: 5/5</translation>\n' +
          '<contextualMeaning>The user wants me to explain the nuance.</contextualMeaning>',
      )
      .mockResolvedValueOnce('Thinking Process:\n1. Analyze the Request.\najeno')
      .mockResolvedValueOnce('ajeno')
      .mockResolvedValueOnce(
        'Source text: estranged\nAnalysis:\nThe place and the memory no longer match.<channel|>El lugar se siente ajeno a la memoria de la protagonista.',
      )
      .mockResolvedValueOnce('El lugar se siente ajeno a la memoria de la protagonista.')
      .mockResolvedValueOnce('La casa le parecia ajena a todo recuerdo.')
      .mockResolvedValueOnce('La casa le parecia ajena a todo recuerdo.');

    const result = await translateWithContext({
      ...baseRequest,
      sourceLanguage: 'en',
      targetLanguage: 'es',
      outputFields: fieldsWithExamples,
    });

    expect(mockCallLLM).toHaveBeenCalledTimes(7);
    expect(result['translation']).toBe('ajeno');
    expect(result['contextualMeaning']).toBe(
      'El lugar se siente ajeno a la memoria de la protagonista.',
    );
  });

  test('allows users to widen the translation sanitizer word limit through harness settings', async () => {
    mockCallLLM.mockResolvedValueOnce(
      '<translation>the faint echo of an almost forgotten old promise</translation>\n' +
        '<contextualMeaning>A memory that still lingers in the scene.</contextualMeaning>',
    );

    const result = await translateWithContext({
      ...baseRequest,
      sourceLanguage: 'en',
      harness: {
        flow: 'production',
        repairEnabled: true,
        repairOnContamination: true,
        repairOnMissingPrimary: true,
        repairOnLowCompletion: true,
        completionThreshold: 0.5,
        maxRepairAttempts: 1,
        perFieldRescueEnabled: true,
        maxPerFieldRepairAttempts: 1,
        detectContamination: true,
        sanitizeOutput: true,
        extractChannelTail: true,
        extractNestedTags: true,
        stripReasoning: true,
        translationMaxWords: 12,
        contaminationMarkers: ['Thinking Process', 'Confidence Score'],
        reasoningMarkers: ['Thinking Process', 'The user wants me'],
      },
    });

    expect(mockCallLLM).toHaveBeenCalledTimes(1);
    expect(result['translation']).toBe('the faint echo of an almost forgotten old promise');
    expect(result['contextualMeaning']).toBe('A memory that still lingers in the scene.');
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

    expect(updates[0]!.fields['simpleDefinition']).toBe('A close confidant');
    expect(updates[0]!.activeFieldId).toBe('simpleDefinition');
    const finalUpdate = updates.at(-2)!;
    expect(finalUpdate.fields['contextualMeaning']).toContain('trusted ally');
  });

  test('streams chinese examples with deterministic pinyin', async () => {
    mockStreamLLM.mockImplementation(async function* () {
      yield '<translation>kindred spirit</translation><examples>1. 知己难逢\n';
      yield 'English: True friends are hard to find.</examples>';
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
