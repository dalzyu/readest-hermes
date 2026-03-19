import { describe, expect, test } from 'vitest';

import { buildTranslationPrompt } from '@/services/contextTranslation/promptBuilder';
import type { TranslationOutputField, TranslationRequest } from '@/services/contextTranslation/types';

const baseFields: TranslationOutputField[] = [
  {
    id: 'translation',
    label: 'Translation',
    enabled: true,
    order: 0,
    promptInstruction: 'Provide a direct translation of the selected text.',
  },
  {
    id: 'contextualMeaning',
    label: 'Contextual Meaning',
    enabled: true,
    order: 1,
    promptInstruction: 'Explain what the word/phrase means given the surrounding context.',
  },
  {
    id: 'examples',
    label: 'Examples',
    enabled: false,
    order: 2,
    promptInstruction: 'Give usage examples.',
  },
];

const baseRequest: TranslationRequest = {
  selectedText: '知己',
  popupContext: {
    localPastContext: 'He had finally found a true 知己 among his companions.',
    localFutureBuffer: 'The next few words clarify the tone.',
    sameBookChunks: ['Earlier in the novel, 知己 described a sworn confidant.'],
    priorVolumeChunks: ['In volume 1, the term appeared during a reunion scene.'],
    retrievalStatus: 'cross-volume',
    retrievalHints: {
      currentVolumeIndexed: true,
      missingLocalIndex: false,
      missingPriorVolumes: [],
      missingSeriesAssignment: false,
    },
  },
  targetLanguage: 'en',
  outputFields: baseFields,
};

describe('buildTranslationPrompt', () => {
  test('includes selected text in prompt', () => {
    const { userPrompt } = buildTranslationPrompt(baseRequest);
    expect(userPrompt).toContain('知己');
  });

  test('includes recent local context in prompt', () => {
    const { userPrompt } = buildTranslationPrompt(baseRequest);
    expect(userPrompt).toContain('He had finally found a true 知己');
  });

  test('includes target language in system prompt', () => {
    const { systemPrompt } = buildTranslationPrompt(baseRequest);
    expect(systemPrompt.toLowerCase()).toContain('english');
  });

  test('includes only enabled fields in system prompt', () => {
    const { systemPrompt } = buildTranslationPrompt(baseRequest);
    expect(systemPrompt).toContain('translation');
    expect(systemPrompt).toContain('contextualMeaning');
    expect(systemPrompt).not.toContain('examples');
  });

  test('includes prompt instructions for enabled fields', () => {
    const { systemPrompt } = buildTranslationPrompt(baseRequest);
    expect(systemPrompt).toContain('Provide a direct translation');
    expect(systemPrompt).toContain('Explain what the word/phrase means');
  });

  test('instructs LLM to use XML tags for each enabled field', () => {
    const { systemPrompt } = buildTranslationPrompt(baseRequest);
    expect(systemPrompt).toContain('<translation>');
    expect(systemPrompt).toContain('<contextualMeaning>');
    expect(systemPrompt).not.toContain('<examples>');
  });

  test('includes structured same-book and prior-volume memory when provided', () => {
    const { userPrompt } = buildTranslationPrompt(baseRequest);

    expect(userPrompt).toContain('Earlier in the novel');
    expect(userPrompt).toContain('In volume 1');
  });

  test('omits empty memory sections when they are absent', () => {
    const { userPrompt } = buildTranslationPrompt({
      ...baseRequest,
      popupContext: {
        ...baseRequest.popupContext,
        sameBookChunks: [],
        priorVolumeChunks: [],
      },
    });

    expect(userPrompt).not.toContain('same_book_memory');
    expect(userPrompt).not.toContain('prior_volume_memory');
  });

  test('includes source language hint when provided', () => {
    const request: TranslationRequest = {
      ...baseRequest,
      sourceLanguage: 'zh',
    };
    const { systemPrompt } = buildTranslationPrompt(request);
    expect(systemPrompt).toContain('zh');
  });

  test('requires enabled fields to be emitted in configured order', () => {
    const request: TranslationRequest = {
      ...baseRequest,
      sourceLanguage: 'zh',
      outputFields: [
        {
          id: 'contextualMeaning',
          label: 'Contextual Meaning',
          enabled: true,
          order: 0,
          promptInstruction: 'Explain what the word/phrase means given the surrounding context.',
        },
        {
          id: 'translation',
          label: 'Translation',
          enabled: true,
          order: 1,
          promptInstruction: 'Provide a direct translation of the selected text.',
        },
      ],
    };

    const { systemPrompt } = buildTranslationPrompt(request);

    expect(systemPrompt).toContain('Emit fields in this exact order');
    expect(systemPrompt).toContain('contextualMeaning, translation');
  });

  test('requires chinese examples to include chinese and english without asking ai for pinyin', () => {
    const request: TranslationRequest = {
      ...baseRequest,
      sourceLanguage: 'zh',
      outputFields: [
        ...baseFields.slice(0, 2),
        {
          id: 'examples',
          label: 'Examples',
          enabled: true,
          order: 2,
          promptInstruction: 'Give usage examples.',
        },
      ],
    };

    const { systemPrompt } = buildTranslationPrompt(request);

    expect(systemPrompt).not.toContain('Pinyin:');
    expect(systemPrompt).toContain('English:');
    expect(systemPrompt).toContain('1. 中文句子');
  });
});
