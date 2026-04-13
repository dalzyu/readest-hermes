import { describe, expect, test } from 'vitest';

import {
  buildTranslationPrompt,
  buildLookupPrompt,
  buildPerFieldPrompt,
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

  test('includes ordered language-pair hints after the fixed output shape', () => {
    const { systemPrompt } = buildTranslationPrompt({
      ...baseRequest,
      sourceLanguage: 'en',
      targetLanguage: 'ru',
    });

    expect(systemPrompt).toContain('Use this exact output shape:');
    const exactIndex = systemPrompt.indexOf('English lacks grammatical aspect and case');
    const sourceWildcardIndex = systemPrompt.indexOf('English source text often hides idioms');
    const targetWildcardIndex = systemPrompt.indexOf('Russian should use a natural literary phrase');
    expect(exactIndex).toBeGreaterThan(-1);
    expect(sourceWildcardIndex).toBeGreaterThan(exactIndex);
    expect(targetWildcardIndex).toBeGreaterThan(sourceWildcardIndex);
  });

  test('tightens the translation and examples field instructions for weak models', () => {
    const { systemPrompt } = buildTranslationPrompt({
      ...baseRequest,
      sourceLanguage: 'en',
      targetLanguage: 'es',
      outputFields: [
        {
          id: 'translation',
          label: 'Translation',
          enabled: true,
          order: 0,
          promptInstruction:
            'Provide ONLY the translated word or short phrase in the target language (1-3 words maximum). Do NOT include explanations, alternatives, parentheticals, or meta-commentary. If there is no exact equivalent, choose the single closest concept.',
        },
        {
          id: 'examples',
          label: 'Examples',
          enabled: true,
          order: 1,
          promptInstruction:
            'Provide 2-3 short example sentences in the TARGET LANGUAGE that use the translated word or phrase naturally. Every sentence must be written entirely in the target language. Do NOT use the source word in examples.',
        },
      ],
    });

    expect(systemPrompt).toContain('1-3 words maximum');
    expect(systemPrompt).toContain('Do NOT include explanations');
    expect(systemPrompt).toContain('Every sentence must be written entirely in the target language');
    expect(systemPrompt).toContain('Do NOT use the source word in examples');
  });

  test('forbids chain-of-thought markers inside tagged fields', () => {
    const { systemPrompt } = buildTranslationPrompt({
      ...baseRequest,
      sourceLanguage: 'en',
      targetLanguage: 'de',
    });

    expect(systemPrompt).toContain('Do not include internal reasoning inside any field');
    expect(systemPrompt).toContain('"Thinking Process"');
    expect(systemPrompt).toContain('"The user wants me"');
    expect(systemPrompt).toContain('"Analyze the Request"');
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

describe('buildPerFieldPrompt', () => {
  test('forbids reasoning markers in single-field rescue prompts', () => {
    const { systemPrompt } = buildPerFieldPrompt(
      {
        id: 'contextualMeaning',
        promptInstruction: 'Explain what the word or phrase means in context.',
      },
      {
        ...baseRequest,
        sourceLanguage: 'en',
        targetLanguage: 'fr',
      },
    );

    expect(systemPrompt).toContain('Do not reveal your reasoning');
    expect(systemPrompt).toContain('"Thinking Process"');
    expect(systemPrompt).toContain('steps');
  });
});

