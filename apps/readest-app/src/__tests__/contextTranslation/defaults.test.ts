import { describe, test, expect } from 'vitest';
import {
  DEFAULT_CONTEXT_TRANSLATION_SETTINGS,
  DEFAULT_CONTEXT_DICTIONARY_SETTINGS,
  CONTEXT_LOOKUP_MODES,
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

describe('CONTEXT_LOOKUP_MODES and dictionary defaults', () => {
  test('exposes translation and dictionary mode ids', () => {
    expect(CONTEXT_LOOKUP_MODES).toEqual(['translation', 'dictionary']);
  });

  test('provides dictionary defaults separate from translation defaults', () => {
    expect(DEFAULT_CONTEXT_DICTIONARY_SETTINGS.enabled).toBe(false);
    expect(DEFAULT_CONTEXT_TRANSLATION_SETTINGS.targetLanguage).toBe('en');
  });
});
