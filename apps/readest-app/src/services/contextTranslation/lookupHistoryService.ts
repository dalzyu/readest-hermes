import type { TranslationResult } from '@/services/contextTranslation/types';

const STORAGE_KEY = 'hermes:lookup-history:v2';
const LEGACY_STORAGE_KEY = 'hermes:lookup-history:v1';
const MAX_HISTORY_ENTRIES = 50;

export interface LookupHistoryEntry {
  id: string;
  recordedAt: number;
  bookHash: string;
  term: string;
  context: string;
  result: TranslationResult;
  mode: 'translation' | 'dictionary';
  location?: string;
}

export type LookupHistoryInput = Omit<LookupHistoryEntry, 'id' | 'recordedAt'> &
  Partial<Pick<LookupHistoryEntry, 'id' | 'recordedAt'>>;

interface StoredLookupHistoryV2 {
  version: 2;
  entries: LookupHistoryEntry[];
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function normalizeResult(result: unknown): TranslationResult | null {
  if (!isPlainObject(result)) return null;

  const normalizedEntries = Object.entries(result)
    .map(([key, value]) => [key, typeof value === 'string' ? value.trim() : ''] as const)
    .filter(([, value]) => value.length > 0)
    .sort(([a], [b]) => a.localeCompare(b));

  if (normalizedEntries.length === 0) return null;

  return Object.fromEntries(normalizedEntries) as TranslationResult;
}

function normalizeLocation(location: unknown): string | undefined {
  if (typeof location !== 'string') return undefined;
  const trimmed = location.trim();
  return trimmed.length > 0 ? trimmed : undefined;
}

function buildEntrySignature(
  entry: Pick<LookupHistoryEntry, 'bookHash' | 'term' | 'mode' | 'result'>,
): string {
  return JSON.stringify([
    entry.bookHash,
    entry.term,
    entry.mode,
    Object.entries(entry.result).sort(([a], [b]) => a.localeCompare(b)),
  ]);
}

function normalizeEntry(raw: Partial<LookupHistoryEntry>): LookupHistoryEntry | null {
  const bookHash = typeof raw.bookHash === 'string' ? raw.bookHash.trim() : '';
  const term = typeof raw.term === 'string' ? raw.term.trim() : '';
  const context = typeof raw.context === 'string' ? raw.context : '';
  const mode = raw.mode;
  const result = normalizeResult(raw.result);
  const recordedAt =
    typeof raw.recordedAt === 'number' && Number.isFinite(raw.recordedAt)
      ? raw.recordedAt
      : Date.now();
  const id =
    typeof raw.id === 'string' && raw.id.trim().length > 0
      ? raw.id.trim()
      : (globalThis.crypto?.randomUUID?.() ??
        `${recordedAt}-${Math.random().toString(36).slice(2)}`);
  const location = normalizeLocation(raw.location);

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
    ...(location ? { location } : {}),
  };
}

function mergeHistoryEntries(
  newer: LookupHistoryEntry,
  older: LookupHistoryEntry,
): LookupHistoryEntry {
  return {
    ...older,
    ...newer,
    id: newer.id,
    recordedAt: newer.recordedAt,
    context: newer.context.trim().length > 0 ? newer.context : older.context,
    location: newer.location ?? older.location,
  };
}

function sortNewestFirst(entries: LookupHistoryEntry[]): LookupHistoryEntry[] {
  return [...entries].sort((a, b) => {
    if (b.recordedAt !== a.recordedAt) return b.recordedAt - a.recordedAt;
    return b.id.localeCompare(a.id);
  });
}

function dedupeHistoryEntries(entries: LookupHistoryEntry[]): LookupHistoryEntry[] {
  const deduped = new Map<string, LookupHistoryEntry>();

  for (const entry of sortNewestFirst(entries)) {
    const signature = buildEntrySignature(entry);
    const existing = deduped.get(signature);
    if (!existing) {
      deduped.set(signature, entry);
      continue;
    }
    deduped.set(signature, mergeHistoryEntries(existing, entry));
  }

  return Array.from(deduped.values()).slice(0, MAX_HISTORY_ENTRIES);
}

function parseStoredHistory(raw: string | null): LookupHistoryEntry[] {
  if (!raw) return [];

  try {
    const parsed = JSON.parse(raw);
    const entries = Array.isArray(parsed)
      ? parsed
      : isPlainObject(parsed) && Array.isArray(parsed['entries'])
        ? parsed['entries']
        : [];

    return entries.reduce<LookupHistoryEntry[]>((acc, item) => {
      const normalized = normalizeEntry(item as Partial<LookupHistoryEntry>);
      if (normalized) acc.push(normalized);
      return acc;
    }, []);
  } catch {
    return [];
  }
}

function serializeHistory(entries: LookupHistoryEntry[]): string {
  const payload: StoredLookupHistoryV2 = { version: 2, entries };
  return JSON.stringify(payload);
}

function saveHistory(entries: LookupHistoryEntry[]): void {
  if (typeof localStorage === 'undefined') return;
  localStorage.setItem(STORAGE_KEY, serializeHistory(entries));
  localStorage.removeItem(LEGACY_STORAGE_KEY);
}

function loadHistory(): LookupHistoryEntry[] {
  if (typeof localStorage === 'undefined') return [];

  const currentRaw = localStorage.getItem(STORAGE_KEY);
  const legacyRaw = localStorage.getItem(LEGACY_STORAGE_KEY);
  const nextEntries = dedupeHistoryEntries([
    ...parseStoredHistory(currentRaw),
    ...parseStoredHistory(legacyRaw),
  ]);

  if (currentRaw !== null || legacyRaw !== null) {
    const serialized = serializeHistory(nextEntries);
    if (legacyRaw !== null || currentRaw !== serialized) {
      saveHistory(nextEntries);
    }
  }

  return nextEntries;
}

export function saveLookupHistoryEntry(raw: LookupHistoryInput): void {
  const entry = normalizeEntry(raw);
  if (!entry) return;

  const history = loadHistory();
  const signature = buildEntrySignature(entry);
  const existing = history.find((item) => buildEntrySignature(item) === signature);
  const mergedEntry = existing
    ? {
        ...entry,
        id: existing.id,
        context: entry.context.trim().length > 0 ? entry.context : existing.context,
        location: entry.location ?? existing.location,
      }
    : entry;
  const nextHistory = dedupeHistoryEntries([
    mergedEntry,
    ...history.filter((item) => buildEntrySignature(item) !== signature),
  ]);

  saveHistory(nextHistory);
}

export function getLookupHistoryForBook(
  bookHash: string,
  limit = MAX_HISTORY_ENTRIES,
): LookupHistoryEntry[] {
  const normalizedBookHash = bookHash.trim();
  if (normalizedBookHash.length === 0) return [];

  return loadHistory()
    .filter((entry) => entry.bookHash === normalizedBookHash)
    .slice(0, limit);
}

export function clearLookupHistory(): void {
  if (typeof localStorage === 'undefined') return;
  localStorage.removeItem(STORAGE_KEY);
  localStorage.removeItem(LEGACY_STORAGE_KEY);
}
