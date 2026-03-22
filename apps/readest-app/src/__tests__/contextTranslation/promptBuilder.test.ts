import { describe, expect, test } from 'vitest';

import {
  buildTranslationPrompt,
  buildLookupPrompt,
} from '@/services/contextTranslation/promptBuilder';
import type {
  TranslationOutputField,
  TranslationRequest,
} from '@/services/contextTranslation/types';

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
    promptInstruction: 'Explain what the word or phrase means in context.',
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
  selectedText: 'zhiji',
  popupContext: {
    localPastContext: 'He had finally found a true confidant among his companions.',
    localFutureBuffer: 'The next few words clarify the tone.',
    sameBookChunks: ['Earlier in the novel, the term described a sworn confidant.'],
    priorVolumeChunks: ['In volume 1, the term appeared during a reunion scene.'],
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
  outputFields: baseFields,
};

describe('buildTranslationPrompt', () => {
  test('includes selected text in prompt', () => {
    const { userPrompt } = buildTranslationPrompt(baseRequest);
    expect(userPrompt).toContain('zhiji');
  });

  test('includes recent local context in prompt', () => {
    const { userPrompt } = buildTranslationPrompt(baseRequest);
    expect(userPrompt).toContain('true confidant');
  });

  test('includes target language in system prompt', () => {
    const { systemPrompt } = buildTranslationPrompt(baseRequest);
    expect(systemPrompt.toLowerCase()).toContain('english');
  });

  test('includes only enabled fields in system prompt', () => {
    const { systemPrompt } = buildTranslationPrompt(baseRequest);
    expect(systemPrompt).toContain('translation');
    expect(systemPrompt).toContain('contextualMeaning');
    expect(systemPrompt).not.toContain('<examples>');
  });

  test('includes prompt instructions for enabled fields', () => {
    const { systemPrompt } = buildTranslationPrompt(baseRequest);
    expect(systemPrompt).toContain('Provide a direct translation');
    expect(systemPrompt).toContain('Explain what the word or phrase means');
  });

  test('instructs the LLM to use XML tags for each enabled field', () => {
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
          promptInstruction: 'Explain what the word or phrase means in context.',
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
});

describe('buildLookupPrompt', () => {
  test('translation prompt requires final sentinel-wrapped JSON output', () => {
    const { systemPrompt } = buildLookupPrompt({ mode: 'translation', ...baseRequest });
    expect(systemPrompt).toContain('<lookup_json>');
  });

  test('preserves field instructions in lookup prompt', () => {
    const { userPrompt } = buildLookupPrompt({ mode: 'translation', ...baseRequest });
    expect(userPrompt).toContain('zhiji');
  });

  test('dictionary prompt globally prohibits pinyin in all response fields', () => {
    const { systemPrompt } = buildLookupPrompt({
      mode: 'dictionary',
      ...baseRequest,
      sourceLanguage: 'zh',
    });
    expect(systemPrompt.toLowerCase()).toContain('pinyin');
    // Must be a prohibition, not an instruction to include it
    expect(systemPrompt).toMatch(/do not include pinyin|without pinyin|no pinyin/i);
  });

  test('dictionary prompt requests source-language simplification fields', () => {
    const { systemPrompt } = buildLookupPrompt({
      mode: 'dictionary',
      ...baseRequest,
      targetLanguage: 'fr',
    });

    expect(systemPrompt).toContain('source language');
    expect(systemPrompt).toContain('<simpleDefinition>');
    expect(systemPrompt).toContain('<contextualMeaning>');
    expect(systemPrompt).not.toContain('Always respond in French');
  });

  test('buildTranslationPrompt injects reference_dictionary block when dictionaryEntries provided', () => {
    const req: TranslationRequest = {
      ...baseRequest,
      popupContext: {
        ...baseRequest.popupContext,
        dictionaryEntries: ['apple: a round fruit', 'apples: plural of apple'],
      },
    };
    const { userPrompt } = buildTranslationPrompt(req);
    expect(userPrompt).toContain('<reference_dictionary>');
    expect(userPrompt).toContain('apple: a round fruit');
  });

  test('buildTranslationPrompt omits reference_dictionary block when dictionaryEntries is empty', () => {
    const req: TranslationRequest = {
      ...baseRequest,
      popupContext: {
        ...baseRequest.popupContext,
        dictionaryEntries: [],
      },
    };
    const { userPrompt } = buildTranslationPrompt(req);
    expect(userPrompt).not.toContain('reference_dictionary');
  });
});
