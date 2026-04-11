import type { VocabularyEntry, TranslationResult, TranslationOutputField } from './types';
import { VOCABULARY_SCHEMA_VERSION } from './types';
import { upgradeSavedVocabularyEntry } from './vocabularyCompatibility';
import { aiStore } from '@/services/ai/storage/aiStore';

type NewEntry = Omit<VocabularyEntry, 'id' | 'addedAt' | 'reviewCount'> &
  Partial<Pick<VocabularyEntry, 'id' | 'addedAt' | 'reviewCount'>>;

export async function saveVocabularyEntry(input: NewEntry): Promise<VocabularyEntry> {
  const entry: VocabularyEntry = {
    id: input.id ?? crypto.randomUUID(),
    bookHash: input.bookHash,
    term: input.term,
    context: input.context,
    result: input.result as TranslationResult,
    addedAt: input.addedAt ?? Date.now(),
    reviewCount: input.reviewCount ?? 0,
    mode: input.mode ?? 'translation',
    schemaVersion: input.schemaVersion ?? VOCABULARY_SCHEMA_VERSION,
    sourceLanguage: input.sourceLanguage,
    targetLanguage: input.targetLanguage,
    examples: input.examples ?? [],
  };
  await aiStore.saveVocabularyEntry(entry);
  return entry;
}

export async function markVocabularyEntryReviewed(
  entry: VocabularyEntry,
): Promise<VocabularyEntry> {
  const reviewedEntry: VocabularyEntry = {
    ...entry,
    reviewCount: entry.reviewCount + 1,
  };
  return saveVocabularyEntry(reviewedEntry);
}

export async function getVocabularyForBook(bookHash: string): Promise<VocabularyEntry[]> {
  const entries = await aiStore.getVocabularyByBook(bookHash);
  return entries.map((entry) => upgradeSavedVocabularyEntry(entry));
}

export async function getAllVocabulary(): Promise<VocabularyEntry[]> {
  const entries = await aiStore.getAllVocabulary();
  return entries.map((entry) => upgradeSavedVocabularyEntry(entry));
}

export async function deleteVocabularyEntry(id: string): Promise<void> {
  return aiStore.deleteVocabularyEntry(id);
}

export async function searchVocabulary(query: string): Promise<VocabularyEntry[]> {
  const entries = await aiStore.searchVocabulary(query);
  return entries.map((entry) => upgradeSavedVocabularyEntry(entry));
}

/** Export entries as Anki-compatible TSV (tab-separated).
 *  Front: term + context snippet. Back: each enabled field on its own line. */
export function exportAsAnkiTSV(
  entries: VocabularyEntry[],
  enabledFields: TranslationOutputField[],
): string {
  const fields = enabledFields.filter((f) => f.enabled).sort((a, b) => a.order - b.order);
  const rows = entries.map((e) => {
    const front = e.context
      ? `${e.term}\n<i>${e.context.slice(0, 120)}${e.context.length > 120 ? '\u2026' : ''}</i>`
      : e.term;
    const back = fields
      .map((f) => {
        const val = e.result[f.id];
        return val ? `<b>${f.label}</b>: ${val}` : '';
      })
      .filter(Boolean)
      .join('<br>');
    return `${front}\t${back}`;
  });
  return rows.join('\n');
}

/** Export entries as CSV with one column per output field. */
export function exportAsCSV(
  entries: VocabularyEntry[],
  enabledFields: TranslationOutputField[],
): string {
  const fields = enabledFields.filter((f) => f.enabled).sort((a, b) => a.order - b.order);
  const csvEscape = (s: string) => `"${s.replace(/"/g, '""')}"`;
  const header = ['Term', 'Context', ...fields.map((f) => f.label)].map(csvEscape).join(',');
  const rows = entries.map((e) => {
    const cols = [e.term, e.context.slice(0, 200), ...fields.map((f) => e.result[f.id] ?? '')].map(
      csvEscape,
    );
    return cols.join(',');
  });
  return [header, ...rows].join('\n');
}
