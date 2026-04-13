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
    dueAt: input.dueAt,
    intervalDays: input.intervalDays,
    easeFactor: input.easeFactor,
    repetition: input.repetition,
    lastReviewedAt: input.lastReviewedAt,
    mode: input.mode ?? 'translation',
    schemaVersion: input.schemaVersion ?? VOCABULARY_SCHEMA_VERSION,
    sourceLanguage: input.sourceLanguage,
    targetLanguage: input.targetLanguage,
    examples: input.examples ?? [],
  };
  await aiStore.saveVocabularyEntry(entry);
  return entry;
}

/**
 * SM-2 spaced repetition update. Grade 0-2 = fail, 3-5 = pass.
 * Returns updated entry with new scheduling fields; does NOT persist.
 */
export function sm2Update(entry: VocabularyEntry, grade: 0 | 1 | 2 | 3 | 4 | 5): VocabularyEntry {
  const EF_MIN = 1.3;
  const ef = Math.max(
    EF_MIN,
    (entry.easeFactor ?? 2.5) + (0.1 - (5 - grade) * (0.08 + (5 - grade) * 0.02)),
  );
  const repetition = entry.repetition ?? 0;
  const now = Date.now();

  if (grade >= 3) {
    // Correct response
    let intervalDays: number;
    if (repetition === 0) intervalDays = 1;
    else if (repetition === 1) intervalDays = 6;
    else intervalDays = Math.round((entry.intervalDays ?? 1) * ef);

    return {
      ...entry,
      reviewCount: entry.reviewCount + 1,
      repetition: repetition + 1,
      intervalDays,
      easeFactor: ef,
      lastReviewedAt: now,
      dueAt: now + intervalDays * 24 * 60 * 60 * 1000,
      schemaVersion: VOCABULARY_SCHEMA_VERSION,
    };
  } else {
    // Incorrect response — reset repetition, interval 1 day, reduce ease factor
    return {
      ...entry,
      reviewCount: entry.reviewCount + 1,
      repetition: 0,
      intervalDays: 1,
      easeFactor: ef,
      lastReviewedAt: now,
      dueAt: now + 24 * 60 * 60 * 1000,
      schemaVersion: VOCABULARY_SCHEMA_VERSION,
    };
  }
}

export async function markVocabularyEntryReviewed(
  entry: VocabularyEntry,
  grade: 0 | 1 | 2 | 3 | 4 | 5 = 3,
): Promise<VocabularyEntry> {
  const updated = sm2Update(entry, grade);
  return saveVocabularyEntry(updated);
}

export async function getVocabularyForBook(bookHash: string): Promise<VocabularyEntry[]> {
  const entries = await aiStore.getVocabularyByBook(bookHash);
  return entries.map((entry) => upgradeSavedVocabularyEntry(entry));
}

/** Returns entries for a book whose dueAt is <= now (or undefined = immediately due), ordered by dueAt asc. */
export async function getDueVocabularyForBook(bookHash: string): Promise<VocabularyEntry[]> {
  const all = await getVocabularyForBook(bookHash);
  const now = Date.now();
  return all
    .filter((e) => e.dueAt === undefined || e.dueAt <= now)
    .sort((a, b) => (a.dueAt ?? 0) - (b.dueAt ?? 0) || a.addedAt - b.addedAt);
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
