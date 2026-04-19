import { describe, test, expect } from 'vitest';
import {
  DEFAULT_CONTEXT_TRANSLATION_SETTINGS,
  DEFAULT_CONTEXT_DICTIONARY_SETTINGS,
  DEFAULT_CONTEXT_DICTIONARY_OUTPUT_FIELDS,
  CONTEXT_LOOKUP_MODES,
  getContextDictionaryOutputFields,
  resolveContextTranslationFieldSources,
} from '@/services/contextTranslation/defaults';
import type {
  BookSeries,
  ContextTranslationSettings,
  TranslationOutputField,
} from '@/services/contextTranslation/types';

describe('DEFAULT_CONTEXT_TRANSLATION_SETTINGS', () => {
  const s: ContextTranslationSettings = DEFAULT_CONTEXT_TRANSLATION_SETTINGS;

  test('is disabled by default', () => {
    expect(s.enabled).toBe(false);
  });

  test('targets English by default', () => {
    expect(s.targetLanguage).toBe('en');
  });

  test('uses at least 2 recent context pages', () => {
    expect(s.recentContextPages).toBeGreaterThanOrEqual(2);
  });

  test('has at least one enabled output field', () => {
    const enabled = s.outputFields.filter((f) => f.enabled);
    expect(enabled.length).toBeGreaterThanOrEqual(1);
  });

  test('translation field is always enabled', () => {
    const translation = s.outputFields.find((f) => f.id === 'translation');
    expect(translation).toBeDefined();
    expect(translation!.enabled).toBe(true);
  });

  test('contextualMeaning field is present and enabled', () => {
    const f = s.outputFields.find((f) => f.id === 'contextualMeaning');
    expect(f).toBeDefined();
    expect(f!.enabled).toBe(true);
  });

  test('all fields have non-empty promptInstruction', () => {
    s.outputFields.forEach((f: TranslationOutputField) => {
      expect(f.promptInstruction.trim().length).toBeGreaterThan(0);
    });
  });

  test('default translation field demands a short direct answer', () => {
    const translation = s.outputFields.find((f) => f.id === 'translation');
    expect(translation?.promptInstruction).toContain('1-3 words maximum');
    expect(translation?.promptInstruction).toContain('Do NOT include explanations');
  });

  test('default examples field requires target-language-only examples', () => {
    const examples = s.outputFields.find((f) => f.id === 'examples');
    expect(examples?.promptInstruction).toContain('TARGET LANGUAGE');
    expect(examples?.promptInstruction).toContain('Do NOT use the source word');
  });

  test('fields have unique, sequential order values', () => {
    const orders = s.outputFields.map((f) => f.order).sort((a, b) => a - b);
    orders.forEach((o, i) => expect(o).toBe(i));
  });

  test('provides defaults for look-ahead and popup rag limits', () => {
    expect(s.lookAheadWords).toBe(80);
    expect(s.sameBookChunkCount).toBeGreaterThan(0);
    expect(s.priorVolumeChunkCount).toBeGreaterThan(0);
  });

  test('provides separate toggles for same-book and prior-volume rag', () => {
    expect(s.sameBookRagEnabled).toBe(true);
    expect(s.priorVolumeRagEnabled).toBe(true);
  });

  test('ships production harness defaults for repair and sanitization', () => {
    expect(s.harness).toBeDefined();
    expect(s.harness?.flow).toBe('production');
    expect(s.harness?.repairEnabled).toBe(true);
    expect(s.harness?.perFieldRescueEnabled).toBe(true);
    expect(s.harness?.translationMaxWords).toBe(8);
    expect(s.harness?.contaminationMarkers?.length ?? 0).toBeGreaterThan(0);
    expect(s.harness?.reasoningMarkers?.length ?? 0).toBeGreaterThan(0);
  });

  test('supports ordered series volumes in the context translation model', () => {
    const series: BookSeries = {
      id: 'series-1',
      name: 'The Grey Castle',
      volumes: [
        { bookHash: 'vol-1', volumeIndex: 1, label: 'Vol. 1' },
        { bookHash: 'vol-2', volumeIndex: 2, label: 'Vol. 2' },
      ],
      createdAt: 1,
      updatedAt: 1,
    };

    expect(series.volumes[1]?.volumeIndex).toBe(2);
  });
});

describe('resolveContextTranslationFieldSources', () => {
  test('defaults to AI-backed sources when unset', () => {
    const resolved = resolveContextTranslationFieldSources(DEFAULT_CONTEXT_TRANSLATION_SETTINGS);

    expect(resolved.translation).toBe('ai');
    expect(resolved.contextualMeaning).toBe('ai');
    expect(resolved.examples).toBe('ai');
    expect(resolved.grammarHint).toBe('ai');
  });

  test('maps legacy source=dictionary into translation field source', () => {
    const resolved = resolveContextTranslationFieldSources({
      ...DEFAULT_CONTEXT_TRANSLATION_SETTINGS,
      source: 'dictionary',
      fieldSources: undefined,
    });

    expect(resolved.translation).toBe('dictionary');
  });
});

describe('CONTEXT_LOOKUP_MODES and dictionary defaults', () => {
  test('exposes translation and dictionary mode ids', () => {
    expect(CONTEXT_LOOKUP_MODES).toEqual(['translation', 'dictionary']);
  });

  test('provides dictionary defaults separate from translation defaults', () => {
    expect(DEFAULT_CONTEXT_DICTIONARY_SETTINGS.enabled).toBe(false);
    expect(DEFAULT_CONTEXT_TRANSLATION_SETTINGS.targetLanguage).toBe('en');
  });
});

describe('getContextDictionaryOutputFields', () => {
  test('returns default fields when no custom promptInstructions', () => {
    const fields = getContextDictionaryOutputFields(DEFAULT_CONTEXT_DICTIONARY_SETTINGS);
    expect(fields).toHaveLength(DEFAULT_CONTEXT_DICTIONARY_OUTPUT_FIELDS.length);
    fields.forEach((f, i) => {
      expect(f.promptInstruction).toBe(
        DEFAULT_CONTEXT_DICTIONARY_OUTPUT_FIELDS[i]!.promptInstruction,
      );
    });
  });

  test('applies custom promptInstruction for a field', () => {
    const fields = getContextDictionaryOutputFields({
      ...DEFAULT_CONTEXT_DICTIONARY_SETTINGS,
      promptInstructions: { simpleDefinition: 'Custom instruction.' },
    });
    const field = fields.find((f) => f.id === 'simpleDefinition')!;
    expect(field.promptInstruction).toBe('Custom instruction.');
  });

  test('leaves other fields unchanged when one is customized', () => {
    const fields = getContextDictionaryOutputFields({
      ...DEFAULT_CONTEXT_DICTIONARY_SETTINGS,
      promptInstructions: { simpleDefinition: 'Custom instruction.' },
    });
    const ctxField = fields.find((f) => f.id === 'contextualMeaning')!;
    const defaultCtxField = DEFAULT_CONTEXT_DICTIONARY_OUTPUT_FIELDS.find(
      (f) => f.id === 'contextualMeaning',
    )!;
    expect(ctxField.promptInstruction).toBe(defaultCtxField.promptInstruction);
  });

  test('sourceExamples enabled follows settings.sourceExamples regardless of custom instructions', () => {
    const fieldsOn = getContextDictionaryOutputFields({
      ...DEFAULT_CONTEXT_DICTIONARY_SETTINGS,
      sourceExamples: true,
    });
    const fieldsOff = getContextDictionaryOutputFields({
      ...DEFAULT_CONTEXT_DICTIONARY_SETTINGS,
      sourceExamples: false,
    });
    expect(fieldsOn.find((f) => f.id === 'sourceExamples')!.enabled).toBe(true);
    expect(fieldsOff.find((f) => f.id === 'sourceExamples')!.enabled).toBe(false);
  });

  test('routes simpleDefinition through dictionary by default while keeping contextualMeaning on AI', () => {
    const fields = getContextDictionaryOutputFields(DEFAULT_CONTEXT_DICTIONARY_SETTINGS);
    expect(fields.find((f) => f.id === 'simpleDefinition')!.enabled).toBe(false);
    expect(fields.find((f) => f.id === 'contextualMeaning')!.enabled).toBe(true);
    expect(fields.find((f) => f.id === 'sourceExamples')!.enabled).toBe(true);
  });

  test('enables only the AI-sourced fields after per-field source overrides', () => {
    const fields = getContextDictionaryOutputFields({
      ...DEFAULT_CONTEXT_DICTIONARY_SETTINGS,
      fieldSources: {
        simpleDefinition: 'ai',
        contextualMeaning: 'dictionary',
        sourceExamples: 'dictionary',
      },
    });

    expect(fields.find((f) => f.id === 'simpleDefinition')!.enabled).toBe(true);
    expect(fields.find((f) => f.id === 'contextualMeaning')!.enabled).toBe(false);
    expect(fields.find((f) => f.id === 'sourceExamples')!.enabled).toBe(false);
  });
});
