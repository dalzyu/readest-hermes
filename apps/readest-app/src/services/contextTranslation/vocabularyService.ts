import type { VocabularyEntry, TranslationResult, TranslationOutputField } from './types';
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
  };
  await aiStore.saveVocabularyEntry(entry);
  return entry;
}

export async function getVocabularyForBook(bookHash: string): Promise<VocabularyEntry[]> {
  return aiStore.getVocabularyByBook(bookHash);
}

export async function getAllVocabulary(): Promise<VocabularyEntry[]> {
  return aiStore.getAllVocabulary();
}

export async function deleteVocabularyEntry(id: string): Promise<void> {
  return aiStore.deleteVocabularyEntry(id);
}

export async function searchVocabulary(query: string): Promise<VocabularyEntry[]> {
  return aiStore.searchVocabulary(query);
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
  const escape = (s: string) => `"${s.replace(/"/g, '""')}"`;
  const header = ['Term', 'Context', ...fields.map((f) => f.label)].map(escape).join(',');
  const rows = entries.map((e) => {
    const cols = [
      e.term,
      e.context.slice(0, 200),
      ...fields.map((f) => e.result[f.id] ?? ''),
    ].map(escape);
    return cols.join(',');
  });
  return [header, ...rows].join('\n');
}
