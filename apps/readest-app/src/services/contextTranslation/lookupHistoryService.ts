import type { TranslationResult } from '@/services/contextTranslation/types';

const STORAGE_KEY = 'readest:lookup-history:v1';
const MAX_HISTORY_ENTRIES = 50;

export interface LookupHistoryEntry {
  id: string;
  recordedAt: number;
  bookHash: string;
  term: string;
  context: string;
  result: TranslationResult;
  mode: 'translation' | 'dictionary';
}

export type LookupHistoryInput = Omit<LookupHistoryEntry, 'id' | 'recordedAt'> &
  Partial<Pick<LookupHistoryEntry, 'id' | 'recordedAt'>>;

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function normalizeResult(result: unknown): TranslationResult | null {
  if (!isPlainObject(result)) return null;

  const normalizedEntries = Object.entries(result)
    .map(([key, value]) => [key, typeof value === 'string' ? value.trim() : ''] as const)
    .filter(([, value]) => value.length > 0);

  if (normalizedEntries.length === 0) return null;

  return Object.fromEntries(normalizedEntries) as TranslationResult;
}

function normalizeEntry(raw: Partial<LookupHistoryEntry>): LookupHistoryEntry | null {
  const bookHash = typeof raw.bookHash === 'string' ? raw.bookHash.trim() : '';
  const term = typeof raw.term === 'string' ? raw.term.trim() : '';
  const context = typeof raw.context === 'string' ? raw.context : '';
  const mode = raw.mode;
  const result = normalizeResult(raw.result);
  const recordedAt = typeof raw.recordedAt === 'number' ? raw.recordedAt : Date.now();
  const id =
    typeof raw.id === 'string' && raw.id.trim().length > 0
      ? raw.id
      : (globalThis.crypto?.randomUUID?.() ??
        `${recordedAt}-${Math.random().toString(36).slice(2)}`);

  if (bookHash.length === 0 || term.length === 0 || !result) return null;
  if (mode !== 'translation' && mode !== 'dictionary') return null;

  return {
    id,
    recordedAt,
    bookHash,
    term,
    context,
    result,
    mode,
  };
}

function loadHistory(): LookupHistoryEntry[] {
  if (typeof localStorage === 'undefined') return [];

  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return [];

    const parsed = JSON.parse(raw);
    if (!Array.isArray(parsed)) return [];

    return parsed.reduce<LookupHistoryEntry[]>((acc, item) => {
      const normalized = normalizeEntry(item as Partial<LookupHistoryEntry>);
      if (normalized) acc.push(normalized);
      return acc;
    }, []);
  } catch {
    return [];
  }
}

function saveHistory(entries: LookupHistoryEntry[]): void {
  if (typeof localStorage === 'undefined') return;
  localStorage.setItem(STORAGE_KEY, JSON.stringify(entries));
}

function sortNewestFirst(entries: LookupHistoryEntry[]): LookupHistoryEntry[] {
  return [...entries].sort((a, b) => {
    if (b.recordedAt !== a.recordedAt) return b.recordedAt - a.recordedAt;
    return b.id.localeCompare(a.id);
  });
}

export function saveLookupHistoryEntry(raw: LookupHistoryInput): void {
  const entry = normalizeEntry(raw);
  if (!entry) return;

  const nextEntries = sortNewestFirst([...loadHistory(), entry]).slice(0, MAX_HISTORY_ENTRIES);
  saveHistory(nextEntries);
}

export function getLookupHistoryForBook(
  bookHash: string,
  limit = MAX_HISTORY_ENTRIES,
): LookupHistoryEntry[] {
  const normalizedBookHash = bookHash.trim();
  if (normalizedBookHash.length === 0) return [];

  return sortNewestFirst(
    loadHistory().filter((entry) => entry.bookHash === normalizedBookHash),
  ).slice(0, limit);
}

export function clearLookupHistory(): void {
  if (typeof localStorage === 'undefined') return;
  localStorage.removeItem(STORAGE_KEY);
}
