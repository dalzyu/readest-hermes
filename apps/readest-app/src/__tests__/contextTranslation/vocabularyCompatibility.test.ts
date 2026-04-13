import { describe, expect, test } from 'vitest';
import { upgradeSavedVocabularyEntry } from '@/services/contextTranslation/vocabularyCompatibility';
import type { VocabularyEntry } from '@/services/contextTranslation/types';

const legacyEntry = {
  id: 'leg-001',
  bookHash: 'book-abc',
  term: '知己',
  context: 'He found a true 知己.',
  result: { translation: 'close friend', contextualMeaning: 'A soulmate.' },
  addedAt: 1700000000000,
  reviewCount: 2,
};

describe('upgradeSavedVocabularyEntry', () => {
  test('upgrades legacy saved translation records into structured lookup data', () => {
    const upgraded = upgradeSavedVocabularyEntry(legacyEntry);
    expect(upgraded.mode).toBe('translation');
  });

  test('sets schemaVersion to current version on upgrade', () => {
    const upgraded = upgradeSavedVocabularyEntry(legacyEntry);
    expect(upgraded.schemaVersion).toBeGreaterThanOrEqual(1);
  });

  test('preserves existing fields when upgrading', () => {
    const upgraded = upgradeSavedVocabularyEntry(legacyEntry);
    expect(upgraded.id).toBe('leg-001');
    expect(upgraded.term).toBe('知己');
    expect(upgraded['result']['translation']).toBe('close friend');
  });

  test('passes through already-upgraded entries unchanged', () => {
    const modernEntry: VocabularyEntry = {
      ...legacyEntry,
      mode: 'dictionary',
      schemaVersion: 1,
    };
    const upgraded = upgradeSavedVocabularyEntry(modernEntry);
    expect(upgraded.mode).toBe('dictionary');
    expect(upgraded.schemaVersion).toBe(1);
  });

  test('defaults examples to empty array when not present', () => {
    const upgraded = upgradeSavedVocabularyEntry(legacyEntry);
    expect(upgraded.examples).toEqual([]);
  });

  test('preserves examples when already present', () => {
    const entryWithExamples = {
      ...legacyEntry,
      examples: [{ exampleId: 'ex-1', text: '他终于找到了知己。' }],
    };
    const upgraded = upgradeSavedVocabularyEntry(entryWithExamples);
    expect(upgraded.examples).toHaveLength(1);
    expect(upgraded.examples![0]!.exampleId).toBe('ex-1');
  });
});
