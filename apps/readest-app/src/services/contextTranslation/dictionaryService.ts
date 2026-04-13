import { gzip } from 'fflate';
import { aiStore } from '@/services/ai/storage/aiStore';
import type { DictionaryEntry, UserDictionary } from './types';
import { extractFromZip } from './dictionaryParser';
import { parseDictionary, detectFormat } from './parsers/formatRouter';
import { getDictionaryForm, isTokenizerReady } from './plugins/jpTokenizer';

const DICTIONARY_STORE = 'dictionaryData';

/** Manifest of dictionaries bundled with the app. */
export interface BUNDLED_DICT {
  id: string;
  language: string;
  targetLanguage: string;
  bundledVersion: string;
}

export const BUNDLED_DICTIONARIES: BUNDLED_DICT[] = [
  { id: 'bundled-zh-en', language: 'zh', targetLanguage: 'en', bundledVersion: '1.0.0' },
  { id: 'bundled-ja-en', language: 'ja', targetLanguage: 'en', bundledVersion: '1.0.0' },
  { id: 'bundled-de-en', language: 'de', targetLanguage: 'en', bundledVersion: '1.0.0' },
  { id: 'bundled-fr-en', language: 'fr', targetLanguage: 'en', bundledVersion: '1.0.0' },
  { id: 'bundled-es-en', language: 'es', targetLanguage: 'en', bundledVersion: '1.0.0' },
  { id: 'bundled-pt-en', language: 'pt', targetLanguage: 'en', bundledVersion: '1.0.0' },
  { id: 'bundled-it-en', language: 'it', targetLanguage: 'en', bundledVersion: '1.0.0' },
  { id: 'bundled-ru-en', language: 'ru', targetLanguage: 'en', bundledVersion: '1.0.0' },
  { id: 'bundled-ar-en', language: 'ar', targetLanguage: 'en', bundledVersion: '1.0.0' },
  { id: 'bundled-ko-en', language: 'ko', targetLanguage: 'en', bundledVersion: '1.0.0' },
];

/** In-memory cache: dictionary id -> entries */
const memoryCache = new Map<string, DictionaryEntry[]>();

/** Levenshtein distance via classic DP O(mn) table. */
function levenshtein(a: string, b: string): number {
  const m = a.length;
  const n = b.length;
  if (m === 0) return n;
  if (n === 0) return m;
  // Use flat array for the DP table
  const dp = new Array<number>((m + 1) * (n + 1));
  for (let i = 0; i <= m; i++) dp[i * (n + 1)] = i;
  for (let j = 0; j <= n; j++) dp[j] = j;
  for (let i = 1; i <= m; i++) {
    for (let j = 1; j <= n; j++) {
      if (a[i - 1] === b[j - 1]) {
        dp[i * (n + 1) + j] = dp[(i - 1) * (n + 1) + j - 1]!;
      } else {
        dp[i * (n + 1) + j] =
          1 +
          Math.min(
            dp[(i - 1) * (n + 1) + j]!, // deletion
            dp[i * (n + 1) + j - 1]!, // insertion
            dp[(i - 1) * (n + 1) + j - 1]!, // substitution
          );
      }
    }
  }
  return dp[m * (n + 1) + n]!;
}

/**
 * Find matching entries in a single dictionary.
 * Pure function exported for unit testing.
 *
 * Tiers (each is exclusive, later tiers only run if earlier found nothing):
 * 1. Exact match via binary search
 * 2. Prefix: headword.startsWith(text) && text.length <= 40
 * 3. Prefix: text.startsWith(headword) && text.length <= 40
 * 4. Fuzzy: Levenshtein <= 2, up to 200 candidates, text.length <= 40
 *
 * Results are deduplicated by headword and capped at 3.
 */
export function findMatches(entries: DictionaryEntry[], text: string): DictionaryEntry[] {
  if (entries.length === 0 || text.length === 0) return [];

  const MAX_PREFIX_LEN = 40;
  const MAX_FUZZY_DISTANCE = 2;
  const MAX_FUZZY_CANDIDATES = 200;
  const MAX_RESULTS = 3;

  // Ensure entries are sorted for binary search (case-sensitive)
  const sortedEntries = [...entries].sort((a, b) =>
    a.headword < b.headword ? -1 : a.headword > b.headword ? 1 : 0,
  );

  // --- Tier 1: Exact match via binary search ---
  let lo = 0;
  let hi = sortedEntries.length - 1;
  while (lo <= hi) {
    const mid = (lo + hi) >>> 1;
    const headword = sortedEntries[mid]!.headword;
    const cmp = headword < text ? -1 : headword > text ? 1 : 0;
    if (cmp === 0) {
      // Found exact match - return immediately
      return [sortedEntries[mid]!];
    } else if (cmp < 0) {
      lo = mid + 1;
    } else {
      hi = mid - 1;
    }
  }

  // Only proceed to later tiers if text.length <= 40
  if (text.length > MAX_PREFIX_LEN) return [];

  const seen = new Set<string>();
  const results: DictionaryEntry[] = [];

  const addResult = (entry: DictionaryEntry) => {
    if (results.length >= MAX_RESULTS) return;
    if (seen.has(entry.headword)) return;
    seen.add(entry.headword);
    results.push(entry);
  };

  // --- Tier 2: headword.startsWith(text) ---
  for (const entry of sortedEntries) {
    if (entry.headword.startsWith(text)) {
      addResult(entry);
    }
  }
  if (results.length > 0) return results;

  // --- Tier 3: text.startsWith(headword) ---
  for (const entry of sortedEntries) {
    if (text.startsWith(entry.headword)) {
      addResult(entry);
    }
  }
  if (results.length > 0) return results;

  // --- Tier 4: Fuzzy ---
  // Consider only first MAX_FUZZY_CANDIDATES entries (already sorted by headword)
  const fuzzyCandidates = sortedEntries.slice(0, MAX_FUZZY_CANDIDATES);
  for (const entry of fuzzyCandidates) {
    if (levenshtein(entry.headword, text) <= MAX_FUZZY_DISTANCE) {
      addResult(entry);
    }
  }

  return results;
}

function compressGzip(data: Uint8Array): Promise<Uint8Array> {
  return new Promise((resolve, reject) => {
    gzip(data, (err, compressed) => {
      if (err) reject(err);
      else resolve(compressed);
    });
  });
}

/** Get all user dictionary metadata from settings. */
export async function getUserDictionaryMeta(): Promise<UserDictionary[]> {
  // Access the settings store directly to read userDictionaryMeta
  // We import lazily to avoid circular deps
  const { useSettingsStore } = await import('@/store/settingsStore');
  return useSettingsStore.getState().settings.userDictionaryMeta ?? [];
}

/** Persist updated user dictionary metadata to settings. */
export async function saveUserDictionaryMeta(meta: UserDictionary[]): Promise<void> {
  const { useSettingsStore } = await import('@/store/settingsStore');
  const current = useSettingsStore.getState().settings;
  // Use setSettings to update in-memory state; callers responsible for full save
  useSettingsStore.getState().setSettings({ ...current, userDictionaryMeta: meta });
}

async function dictionaryDataRecord(id: string): Promise<{
  id: string;
  meta: UserDictionary;
  blob: Uint8Array;
} | null> {
  return aiStore.getRecord(DICTIONARY_STORE, id) as Promise<{
    id: string;
    meta: UserDictionary;
    blob: Uint8Array;
  } | null>;
}

/** Load entries for a dictionary from IndexedDB (or memory cache). */
async function loadDictionaryEntries(id: string): Promise<DictionaryEntry[]> {
  if (memoryCache.has(id)) return memoryCache.get(id)!;

  const record = await dictionaryDataRecord(id);
  if (!record) return [];

  const { decompress } = await import('fflate');
  const entries: DictionaryEntry[] = await new Promise((resolve, reject) => {
    decompress(record.blob, (err, decompressed) => {
      if (err) {
        reject(err);
        return;
      }
      try {
        const json = new TextDecoder('utf-8').decode(decompressed);
        resolve(JSON.parse(json) as DictionaryEntry[]);
      } catch (e) {
        reject(e);
      }
    });
  });

  memoryCache.set(id, entries);
  return entries;
}

/**
 * Preview a StarDict zip file without fully importing it.
 * Phase 1: extractFromZip -> parseIfo (get name and wordcount for display).
 * Returns metadata needed to show the import confirmation dialog.
 */
export async function previewDictionaryZip(
  zipFile: File | Uint8Array,
): Promise<{ name: string; wordcount: number }> {
  const buffer = zipFile instanceof File ? new Uint8Array(await zipFile.arrayBuffer()) : zipFile;
  const filename = zipFile instanceof File ? zipFile.name : 'dictionary.zip';
  const format = detectFormat(filename, buffer);

  if (format === 'stardict') {
    const { ifo } = await extractFromZip(buffer);
    const ifoResult = (await import('./dictionaryParser')).parseIfo(ifo);
    return { name: ifoResult.name, wordcount: ifoResult.wordcount };
  }

  // For non-StarDict formats, do a full parse to get the count
  const { entries, name } = await parseDictionary(filename, buffer);
  return { name, wordcount: entries.length };
}

/**
 * Import a user dictionary from a StarDict zip file.
 *
 * Phase 1: extractFromZip -> parseIfo (get wordcount for display)
 * Phase 2: parseStarDict -> gzip compress -> write to IndexedDB
 * Write to settings userDictionaryMeta
 * Throw if 0 entries
 */
export async function importUserDictionary(
  zipFile: File | Uint8Array,
  meta: { name: string; language: string; targetLanguage: string },
): Promise<UserDictionary> {
  const buffer = zipFile instanceof File ? new Uint8Array(await zipFile.arrayBuffer()) : zipFile;
  const filename = zipFile instanceof File ? zipFile.name : 'dictionary.zip';

  const { entries } = await parseDictionary(filename, buffer);
  if (entries.length === 0) {
    throw new Error('Dictionary has 0 entries');
  }

  const id = `user-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
  const jsonBytes = new TextEncoder().encode(JSON.stringify(entries));
  const compressed = await compressGzip(jsonBytes);

  const userMeta: UserDictionary = {
    id,
    name: meta.name,
    language: meta.language,
    targetLanguage: meta.targetLanguage,
    entryCount: entries.length,
    source: 'user',
    importedAt: Date.now(),
  };

  await aiStore.putRecord(DICTIONARY_STORE, { id, meta: userMeta, blob: compressed });

  // Update settings
  const allMeta = await getUserDictionaryMeta();
  allMeta.push(userMeta);
  await saveUserDictionaryMeta(allMeta);

  // Cache entries
  memoryCache.set(id, entries);

  return userMeta;
}

/**
 * Delete a user dictionary.
 * - Remove from IndexedDB
 * - Remove from userDictionaryMeta in settings
 * - Clear from memory cache
 */
export async function deleteUserDictionary(id: string): Promise<void> {
  await aiStore.deleteRecord(DICTIONARY_STORE, id);
  memoryCache.delete(id);
  const allMeta = await getUserDictionaryMeta();
  const filtered = allMeta.filter((m) => m.id !== id);
  await saveUserDictionaryMeta(filtered);
}

/**
 * Initialize bundled dictionaries.
 * - Check IndexedDB for each BUNDLED_DICTIONARIES entry
 * - For missing: fetch public/dictionaries/[id].json.gz (catch and log, no crash)
 * - For stale version: re-fetch and replace
 * - Mark as ready
 */
export async function initBundledDictionaries(): Promise<void> {
  for (const bundled of BUNDLED_DICTIONARIES) {
    const existing = await dictionaryDataRecord(bundled.id);
    const needsInit =
      !existing ||
      (existing.meta.source === 'bundled' &&
        existing.meta.bundledVersion !== bundled.bundledVersion);

    if (needsInit) {
      try {
        const url = `/dictionaries/${bundled.id}.json.gz`;
        const response = await fetch(url);
        if (!response.ok) {
          // Bundled dict not yet built — expected during development
          console.warn(`[dictionaryService] Bundled dictionary not found: ${url}`);
          continue;
        }
        const blob = new Uint8Array(await response.arrayBuffer());

        // Decompress and parse to validate
        const { decompress } = await import('fflate');
        const decompressed: Uint8Array = await new Promise((resolve, reject) => {
          decompress(blob, (err, result) => {
            if (err) {
              reject(err);
              return;
            }
            resolve(result!);
          });
        });
        const entries = JSON.parse(
          new TextDecoder('utf-8').decode(decompressed),
        ) as DictionaryEntry[];

        const bundledMeta: UserDictionary = {
          id: bundled.id,
          name: bundled.id,
          language: bundled.language,
          targetLanguage: bundled.targetLanguage,
          entryCount: entries.length,
          source: 'bundled',
          importedAt: 0,
          bundledVersion: bundled.bundledVersion,
        };

        await aiStore.putRecord(DICTIONARY_STORE, { id: bundled.id, meta: bundledMeta, blob });
        memoryCache.set(bundled.id, entries);
      } catch (err) {
        // Catch all errors — logging and continuing per spec
        console.error(`[dictionaryService] Failed to init bundled dictionary ${bundled.id}:`, err);
      }
    } else if (existing) {
      // Pre-load into memory cache
      const entries = await loadDictionaryEntries(bundled.id);
      memoryCache.set(bundled.id, entries);
    }
  }
}

/** Ranking helpers */
type RankedEntry = {
  entry: DictionaryEntry;
  dictionaryId: string;
  category: 1 | 2; // 1 = bilingual, 2 = monolingual
  isUser: boolean;
  importedAt: number;
};

function rankEntries(
  entries: DictionaryEntry[],
  dictionaryId: string,
  isUser: boolean,
  importedAt: number,
  isMonolingual: boolean,
): RankedEntry {
  return {
    entry: entries[0]!, // Caller ensures at least 1 entry per call
    dictionaryId,
    category: isMonolingual ? 2 : 1,
    isUser,
    importedAt,
  };
}

/**
 * Lookup definitions across all matching dictionaries.
 *
 * - Load matching dictionaries from IndexedDB (or memory cache)
 * - Filter to: (sourceLang matches AND targetLang matches) OR (sourceLang matches AND monolingual)
 * - Rank: category 1 > category 2; within same: user > bundled; within user: higher importedAt
 * - Call findMatches on each, take up to 1 result per dictionary
 * - Deduplicate by headword, cap at 3 total
 */
export async function lookupDefinitions(
  text: string,
  sourceLang: string,
  targetLang: string,
  disabledBundledDicts: string[] = [],
): Promise<DictionaryEntry[]> {
  if (!text) return [];

  // For Japanese, deconjugate to dictionary form and search both surface + base form
  const isJapanese = sourceLang === 'ja';
  const baseForm = isJapanese && isTokenizerReady() ? getDictionaryForm(text) : null;
  const searchTerms = baseForm && baseForm !== text ? [text, baseForm] : [text];

  const MAX_RESULTS = 3;

  const allBundled: UserDictionary[] = BUNDLED_DICTIONARIES.map((b) => ({
    id: b.id,
    name: b.id,
    language: b.language,
    targetLanguage: b.targetLanguage,
    entryCount: 0,
    source: 'bundled' as const,
    importedAt: 0,
    bundledVersion: b.bundledVersion,
    enabled: !disabledBundledDicts.includes(b.id),
  }));

  const allUser = await getUserDictionaryMeta();

  const allDicts: UserDictionary[] = [...allBundled, ...allUser].filter((d) => d.enabled !== false);

  // Filter to matching dictionaries
  const matching = allDicts.filter((d) => {
    const sourceMatch = d.language === sourceLang;
    const targetMatch = d.targetLanguage === targetLang;
    const monolingual = d.language === d.targetLanguage;
    return (sourceMatch && targetMatch) || (sourceMatch && monolingual);
  });

  // Rank them
  const ranked: RankedEntry[] = [];
  for (const dict of matching) {
    const isUser = dict.source === 'user';
    const entries = await loadDictionaryEntries(dict.id);
    if (entries.length === 0) continue;

    // Determine if monolingual
    const isMonolingual = dict.language === dict.targetLanguage;
    ranked.push(rankEntries(entries, dict.id, isUser, dict.importedAt, isMonolingual));
  }

  // Sort: category 1 > 2, then user > bundled, then higher importedAt
  ranked.sort((a, b) => {
    if (a.category !== b.category) return a.category - b.category; // 1 before 2
    if (a.isUser !== b.isUser) return a.isUser ? -1 : 1; // user before bundled
    return b.importedAt - a.importedAt; // higher importedAt first
  });

  // Take up to 1 entry per dictionary from ranked list
  const seenHeadwords = new Set<string>();
  const results: DictionaryEntry[] = [];

  for (const rankedEntry of ranked) {
    if (results.length >= MAX_RESULTS) break;

    const entries = await loadDictionaryEntries(rankedEntry.dictionaryId);

    // Try each search term (surface form first, then base form if different)
    let matches: DictionaryEntry[] = [];
    for (const term of searchTerms) {
      matches = findMatches(entries, term);
      if (matches.length > 0) break;
    }

    // Take up to 1 from this dictionary
    for (const match of matches) {
      if (results.length >= MAX_RESULTS) break;
      if (seenHeadwords.has(match.headword)) continue;
      seenHeadwords.add(match.headword);
      results.push({ ...match, source: rankedEntry.dictionaryId });
    }
  }

  return results;
}
