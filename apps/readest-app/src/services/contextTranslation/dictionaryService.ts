import { gzip } from 'fflate';
import type { ConvertChineseVariant } from '@/types/book';
import { aiStore } from '@/services/ai/storage/aiStore';
import { initSimpleCC, runSimpleCC } from '@/utils/simplecc';
import { normalizedLangCode } from '@/utils/lang';
import type { DictionaryEntry, UserDictionary } from './types';
import { extractFromZip } from './dictionaryParser';
import { parseDictionary, detectFormat } from './parsers/formatRouter';
import { getDictionaryForm, isTokenizerReady } from './plugins/jpTokenizer';

export {
  SUPPORTED_DICTIONARY_IMPORT_EXTENSIONS,
  SUPPORTED_DICTIONARY_IMPORT_FORMATS,
} from './parsers/formatRouter';

const DICTIONARY_STORE = 'dictionaryData';

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

function normalizeLookupText(value: string): string {
  return value.normalize('NFKC').trim().toLocaleLowerCase();
}

type SearchableEntry = {
  entry: DictionaryEntry;
  normalizedHeadword: string;
};

/** Dictionary entry arrays are immutable after load, so cache the indexed view by array identity. */
const searchableEntriesCache = new WeakMap<DictionaryEntry[], SearchableEntry[]>();

function getSearchableEntries(entries: DictionaryEntry[]): SearchableEntry[] {
  const cached = searchableEntriesCache.get(entries);
  if (cached) return cached;

  const searchableEntries = entries
    .map((entry) => ({ entry, normalizedHeadword: normalizeLookupText(entry.headword) }))
    .filter((entry) => entry.normalizedHeadword.length > 0)
    .sort((a, b) =>
      a.normalizedHeadword < b.normalizedHeadword
        ? -1
        : a.normalizedHeadword > b.normalizedHeadword
          ? 1
          : 0,
    );

  searchableEntriesCache.set(entries, searchableEntries);
  return searchableEntries;
}

type MatchTier = 1 | 2 | 3 | 4;

type MatchResult = {
  matches: DictionaryEntry[];
  tier: MatchTier | null;
};

export type DictionaryLookupOptions = {
  maxMatchTier?: MatchTier;
};

function findMatchesWithTier(entries: DictionaryEntry[], text: string): MatchResult {
  if (entries.length === 0 || text.length === 0) return { matches: [], tier: null };

  const searchableEntries = getSearchableEntries(entries);
  const normalizedText = normalizeLookupText(text);
  if (!normalizedText) return { matches: [], tier: null };

  const MAX_PREFIX_LEN = 40;
  const MAX_FUZZY_DISTANCE = 2;
  const MAX_FUZZY_CANDIDATES = 200;
  const MAX_RESULTS = 3;

  let lo = 0;
  let hi = searchableEntries.length - 1;
  while (lo <= hi) {
    const mid = (lo + hi) >>> 1;
    const headword = searchableEntries[mid]!.normalizedHeadword;
    const cmp = headword < normalizedText ? -1 : headword > normalizedText ? 1 : 0;
    if (cmp === 0) {
      return { matches: [searchableEntries[mid]!.entry], tier: 1 };
    }
    if (cmp < 0) {
      lo = mid + 1;
    } else {
      hi = mid - 1;
    }
  }

  if (normalizedText.length > MAX_PREFIX_LEN) return { matches: [], tier: null };

  const seen = new Set<string>();
  const results: DictionaryEntry[] = [];

  const addResult = (candidate: SearchableEntry) => {
    if (results.length >= MAX_RESULTS) return;
    if (seen.has(candidate.normalizedHeadword)) return;
    seen.add(candidate.normalizedHeadword);
    results.push(candidate.entry);
  };

  for (const candidate of searchableEntries) {
    if (candidate.normalizedHeadword.startsWith(normalizedText)) {
      addResult(candidate);
    }
  }
  if (results.length > 0) return { matches: results, tier: 2 };

  for (const candidate of searchableEntries) {
    if (normalizedText.startsWith(candidate.normalizedHeadword)) {
      addResult(candidate);
    }
  }
  if (results.length > 0) return { matches: results, tier: 3 };

  for (const candidate of searchableEntries.slice(0, MAX_FUZZY_CANDIDATES)) {
    if (levenshtein(candidate.normalizedHeadword, normalizedText) <= MAX_FUZZY_DISTANCE) {
      addResult(candidate);
    }
  }

  if (results.length > 0) return { matches: results, tier: 4 };
  return { matches: [], tier: null };
}

/**
 * Find matching entries in a single dictionary.
 * The normalized search index is cached internally for repeated lookups.
 *
 * Tiers (each is exclusive, later tiers only run if earlier found nothing):
 * 1. Exact match via binary search on normalized headwords
 * 2. Prefix: headword.startsWith(text) && text.length <= 40
 * 3. Prefix: text.startsWith(headword) && text.length <= 40
 * 4. Fuzzy: Levenshtein <= 2, up to 200 candidates, text.length <= 40
 *
 * Results are deduplicated by normalized headword and capped at 3.
 */
export function findMatches(entries: DictionaryEntry[], text: string): DictionaryEntry[] {
  return findMatchesWithTier(entries, text).matches;
}

function compressGzip(data: Uint8Array): Promise<Uint8Array> {
  return new Promise((resolve, reject) => {
    gzip(data, (err, compressed) => {
      if (err) reject(err);
      else resolve(compressed);
    });
  });
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

function getDictionaryImportErrorMessage(filename: string, error: unknown): string {
  if (error instanceof Error && error.message.trim()) {
    return `Failed to import ${filename}: ${error.message}`;
  }
  if (typeof error === 'string' && error.trim()) {
    return `Failed to import ${filename}: ${error}`;
  }
  return `Failed to import ${filename}: unknown error`;
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
  try {
    const format = detectFormat(filename, buffer);

    if (format === 'stardict') {
      const { ifo } = await extractFromZip(buffer);
      const ifoResult = (await import('./dictionaryParser')).parseIfo(ifo);
      return { name: ifoResult.name, wordcount: ifoResult.wordcount };
    }

    // For non-StarDict formats, do a full parse to get the count
    const { entries, name } = await parseDictionary(filename, buffer);
    return { name, wordcount: entries.length };
  } catch (error) {
    throw new Error(getDictionaryImportErrorMessage(filename, error));
  }
}

/**
 * Import a user dictionary into dictionary storage.
 *
 * This function owns parsing and blob storage only. Metadata persistence belongs
 * to the settings/UI layer so imports have exactly one settings write path.
 * Throw if 0 entries.
 */
export async function importUserDictionary(
  zipFile: File | Uint8Array,
  meta: { name: string; language: string; targetLanguage: string },
): Promise<UserDictionary> {
  const buffer = zipFile instanceof File ? new Uint8Array(await zipFile.arrayBuffer()) : zipFile;
  const filename = zipFile instanceof File ? zipFile.name : 'dictionary.zip';

  try {
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
    // Ensure any stale cache entry for this id is cleared before setting the new one.
    memoryCache.delete(id);
    memoryCache.set(id, entries);

    return userMeta;
  } catch (error) {
    throw new Error(getDictionaryImportErrorMessage(filename, error));
  }
}

/**
 * Delete a user dictionary from dictionary storage.
 *
 * Metadata persistence belongs to the settings/UI layer so deletes have exactly
 * one settings write path.
 */
export async function deleteUserDictionary(id: string): Promise<void> {
  await aiStore.deleteRecord(DICTIONARY_STORE, id);
  memoryCache.delete(id);
}

const CHINESE_VARIANT_TRANSFORMS: readonly ConvertChineseVariant[] = [
  's2t',
  's2tw',
  's2twp',
  's2hk',
  't2s',
  'tw2s',
  'tw2sp',
  'hk2s',
];

async function buildDictionarySearchTerms(text: string, sourceLang: string): Promise<string[]> {
  const terms = new Set<string>();
  const normalizedSourceLang = normalizedLangCode(sourceLang);
  const addTerm = (value: string | null | undefined) => {
    const trimmed = value?.trim();
    if (trimmed) terms.add(trimmed);
  };

  addTerm(text);

  if (normalizedSourceLang === 'ja' && isTokenizerReady()) {
    addTerm(getDictionaryForm(text));
  }

  if (normalizedSourceLang === 'zh') {
    try {
      await initSimpleCC();
      for (const variant of CHINESE_VARIANT_TRANSFORMS) {
        addTerm(runSimpleCC(text, variant));
      }
    } catch {
      // Variant conversion is a best-effort lookup enhancement, not a hard dependency.
    }
  }

  return [...terms];
}

/** Ranking helpers */
type RankedEntry = {
  dictionaryId: string;
  sourceName: string;
  category: 1 | 2; // 1 = bilingual, 2 = monolingual
  importedAt: number;
};

function rankEntry(
  dictionaryId: string,
  sourceName: string,
  importedAt: number,
  isMonolingual: boolean,
): RankedEntry {
  return {
    dictionaryId,
    sourceName,
    category: isMonolingual ? 2 : 1,
    importedAt,
  };
}

/**
 * Lookup definitions across all matching dictionaries.
 *
 * - Load matching user dictionaries from IndexedDB (or memory cache)
 * - Filter to: (sourceLang matches AND targetLang matches) OR (sourceLang matches AND monolingual)
 * - Rank: category 1 > category 2; within same category, newer imports first
 * - Call findMatches on each, take up to 1 result per dictionary
 * - Deduplicate by headword, cap at 3 total
 */
export async function lookupDefinitions(
  text: string,
  sourceLang: string,
  targetLang: string,
  userDictionaryMeta: UserDictionary[],
  options: DictionaryLookupOptions = {},
): Promise<DictionaryEntry[]> {
  if (!text) return [];

  const searchTerms = await buildDictionarySearchTerms(text, sourceLang);

  const MAX_RESULTS = 3;
  const maxMatchTier = options.maxMatchTier ?? 4;
  const normalizedSourceLang = normalizedLangCode(sourceLang);
  const normalizedTargetLang = normalizedLangCode(targetLang);

  const allUser = userDictionaryMeta.filter(
    (dictionary) => dictionary.enabled !== false && dictionary.source === 'user',
  );
  const matching = allUser.filter((dictionary) => {
    const dictionarySourceLang = normalizedLangCode(dictionary.language);
    const dictionaryTargetLang = normalizedLangCode(dictionary.targetLanguage);
    const sourceMatch = dictionarySourceLang === normalizedSourceLang;
    const targetMatch = dictionaryTargetLang === normalizedTargetLang;
    const monolingual = dictionarySourceLang === dictionaryTargetLang;
    return (sourceMatch && targetMatch) || (sourceMatch && monolingual);
  });

  // Rank them
  const loadedDicts = await Promise.all(
    matching.map(async (dict) => ({
      dict,
      entries: await loadDictionaryEntries(dict.id),
    })),
  );

  const ranked: RankedEntry[] = [];
  for (const { dict, entries } of loadedDicts) {
    if (entries.length === 0) continue;
    const isMonolingual =
      normalizedLangCode(dict.language) === normalizedLangCode(dict.targetLanguage);
    ranked.push(rankEntry(dict.id, dict.name, dict.importedAt, isMonolingual));
  }

  // Sort: category 1 > 2, then higher importedAt
  ranked.sort((a, b) => {
    if (a.category !== b.category) return a.category - b.category; // 1 before 2
    return b.importedAt - a.importedAt; // higher importedAt first
  });

  // Take up to 1 entry per dictionary from ranked list
  const seenHeadwords = new Set<string>();
  const results: DictionaryEntry[] = [];

  for (const rankedEntry of ranked) {
    if (results.length >= MAX_RESULTS) break;

    const entries = await loadDictionaryEntries(rankedEntry.dictionaryId);

    // Prefer the strongest tier across all search terms so an exact variant match
    // beats a weaker prefix fallback on the original surface form.
    let bestMatches: MatchResult = { matches: [], tier: null };
    for (const term of searchTerms) {
      const candidateMatches = findMatchesWithTier(entries, term);
      if (candidateMatches.matches.length === 0) continue;
      if (bestMatches.tier === null || candidateMatches.tier! < bestMatches.tier) {
        bestMatches = candidateMatches;
      }
      if (bestMatches.tier === 1) break;
    }
    if (bestMatches.tier === null || bestMatches.tier > maxMatchTier) continue;
    const matches = bestMatches.matches;

    // Take up to 1 from this dictionary
    for (const match of matches) {
      if (results.length >= MAX_RESULTS) break;
      if (seenHeadwords.has(match.headword)) continue;
      seenHeadwords.add(match.headword);
      results.push({ ...match, source: rankedEntry.sourceName });
    }
  }

  return results;
}
