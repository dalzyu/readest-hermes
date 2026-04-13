import type { VocabularyEntry } from './types';
import { VOCABULARY_SCHEMA_VERSION } from './types';

/**
 * Upgrades a persisted vocabulary entry (possibly from an older schema) to
 * the current VocabularyEntry shape.
 *
 * Rules:
 * - Legacy entries without `mode` are assumed to be 'translation'.
 * - Missing `examples` default to [].
 * - Missing SM-2 fields fall back to the initial scheduling defaults.
 * - Already-upgraded entries are returned with existing field values preserved.
 * - schemaVersion is set to VOCABULARY_SCHEMA_VERSION if absent.
 */
export function upgradeSavedVocabularyEntry(raw: unknown): VocabularyEntry {
  const entry = raw as Record<string, unknown>;
  return {
    id: entry['id'] as string,
    bookHash: entry['bookHash'] as string,
    term: entry['term'] as string,
    context: entry['context'] as string,
    result: entry['result'] as VocabularyEntry['result'],
    addedAt: entry['addedAt'] as number,
    reviewCount: (entry['reviewCount'] as number) ?? 0,
    mode: (entry['mode'] as VocabularyEntry['mode']) ?? 'translation',
    schemaVersion: (entry['schemaVersion'] as number) ?? VOCABULARY_SCHEMA_VERSION,
    sourceLanguage: entry['sourceLanguage'] as string | undefined,
    targetLanguage: entry['targetLanguage'] as string | undefined,
    examples: Array.isArray(entry['examples'])
      ? (entry['examples'] as VocabularyEntry['examples'])
      : [],
    dueAt: entry['dueAt'] as number | undefined,
    intervalDays: (entry['intervalDays'] as number | undefined) ?? 0,
    easeFactor: (entry['easeFactor'] as number | undefined) ?? 2.5,
    repetition: (entry['repetition'] as number | undefined) ?? 0,
    lastReviewedAt: entry['lastReviewedAt'] as number | undefined,
  };
}
