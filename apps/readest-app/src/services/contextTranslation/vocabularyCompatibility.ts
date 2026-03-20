import type { VocabularyEntry } from './types';
import { VOCABULARY_SCHEMA_VERSION } from './types';

/**
 * Upgrades a persisted vocabulary entry (possibly from an older schema) to
 * the current VocabularyEntry shape.
 *
 * Rules:
 * - Legacy entries without `mode` are assumed to be 'translation'.
 * - Missing `examples` default to [].
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
  };
}
