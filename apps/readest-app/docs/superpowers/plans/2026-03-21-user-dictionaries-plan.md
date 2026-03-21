# User Dictionary RAG — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Allow users to import StarDict dictionaries and use bundled open-source dictionaries. Relevant dictionary entries are injected into the AI prompt at lookup time to ground translations.

**Architecture:** A two-phase StarDict parser (quick `.ifo` preview + full parse) writes gzip-compressed `DictionaryEntry[]` blobs to a new `dictionaryData` IndexedDB store. A `dictionaryService.ts` module manages import/delete/init/lookup with an in-memory headword cache. `buildPopupContextBundle` calls `lookupDefinitions` in parallel with RAG retrieval and appends `dictionaryEntries` to `PopupContextBundle`. `promptBuilder.ts` injects a `<reference_dictionary>` block. The Settings UI manages bundled + user dictionaries.

**Tech Stack:** `fflate` (zip + gzip), IndexedDB, TypeScript, Vitest

---

## Phase 1 — Types, Storage, and Parser

### Task 1: Add types

**Files:**
- Modify: `src/services/contextTranslation/types.ts` (append)
- Modify: `src/types/settings.ts`
- Modify: `src/services/ai/storage/aiStore.ts`

Add to `src/services/contextTranslation/types.ts` (after existing exports):

```typescript
/** A single entry from a StarDict dictionary. */
export interface DictionaryEntry {
  headword: string;
  definition: string;
}

/** A dictionary installed in the app. */
export interface UserDictionary {
  id: string;
  name: string;
  /** ISO 639-1 source language (headword language). */
  language: string;
  /** ISO 639-1 definition language. Same as language for monolingual. */
  targetLanguage: string;
  entryCount: number;
  source: 'bundled' | 'user';
  importedAt: number;
  /** Only when source === 'bundled'. Must match BUNDLED_DICTIONARIES version. */
  bundledVersion?: string;
}
```

Add `userDictionaryMeta: UserDictionary[]` to `SystemSettings` in `src/types/settings.ts`:

```typescript
// after customFonts: CustomFont[]
userDictionaryMeta: UserDictionary[];
```

Bump `DB_VERSION` in `aiStore.ts` from `4` to `5`. Add a new constant:

```typescript
const DICTIONARY_STORE = 'dictionaryData';
```

In `onupgradeneeded`, add the new store:

```typescript
if (!db.objectStoreNames.contains(DICTIONARY_STORE)) {
  db.createObjectStore(DICTIONARY_STORE, { keyPath: 'id' });
}
```

Also add three generic methods to the `AIStore` class (before the closing `}` of the class, around line 680):

```typescript
async getRecord<T>(store: string, id: string): Promise<T | null> {
  const db = await this.openDB();
  return new Promise((resolve, reject) => {
    const req = db.transaction(store, 'readonly').objectStore(store).get(id);
    req.onsuccess = () => resolve((req.result as T) ?? null);
    req.onerror = () => reject(req.error);
  });
}

async putRecord<T>(store: string, record: T): Promise<void> {
  const db = await this.openDB();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(store, 'readwrite');
    tx.objectStore(store).put(record);
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error);
  });
}

async deleteRecord(store: string, id: string): Promise<void> {
  const db = await this.openDB();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(store, 'readwrite');
    tx.objectStore(store).delete(id);
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error);
  });
}
```

- [ ] **Step 1: Write the failing test**

Run: `npx vitest run src/__tests__/contextTranslation/dictionaryParser.test.ts 2>&1 | tail -5`
Expected: FAIL — file not found

- [ ] **Step 2: Add types to types.ts**

Add `DictionaryEntry` and `UserDictionary` interfaces.

- [ ] **Step 3: Add userDictionaryMeta to SystemSettings**

Run: `npx vitest run src/__tests__/utils/misc.test.ts -v 2>&1 | tail -5`
Expected: PASS (no regression)

- [ ] **Step 4: Bump DB_VERSION and add dictionaryData store**

Run: `npx vitest run src/__tests__/ai/aiStore.test.ts -v 2>&1 | tail -5`
Expected: PASS (no regression — version bump doesn't break existing tests)

- [ ] **Step 5: Commit**

```bash
git add src/services/contextTranslation/types.ts src/types/settings.ts src/services/ai/storage/aiStore.ts
git commit -m "feat(context-dict): add DictionaryEntry/UserDictionary types, bump IndexedDB schema to v5"
```

---

### Task 2: StarDict parser

**Files:**
- Create: `src/services/contextTranslation/dictionaryParser.ts`
- Test: `src/__tests__/contextTranslation/dictionaryParser.test.ts`

The parser module exports:
1. `parseIfo(buffer: Uint8Array): { name: string; wordcount: number }` — reads the `.ifo` file
2. `parseStarDict(buffers: { ifo: Uint8Array; idx: Uint8Array; dict: Uint8Array }): DictionaryEntry[]` — full parse, returns sorted entries
3. `extractFromZip(zipBuffer: Uint8Array): Promise<{ ifo: Uint8Array; idx: Uint8Array; dict: Uint8Array }>` — unzip and find the three files

**`parseIfo`** — decode as UTF-8, split by newlines, parse `key=value` pairs. Extract `bookname`, `wordcount`, `sametypesequence`.

**`parseStarDict`** — for each entry in `.idx`:
- Read null-terminated UTF-8 headword
- Read 4-byte big-endian offset
- Read 4-byte big-endian size
- Slice `dict` buffer from offset to offset+size
- Decode as UTF-8
- Strip HTML tags if `sametypesequence` first char is `h` (regex: `/<[^>]+>/g`)
- If `sametypesequence` first char is `t`, treat as plain text
- If `sametypesequence` first char is `m`, treat as plain text
- Skip unrecognized types; ignore any additional fields
- Return `DictionaryEntry[]` sorted by headword (StarDict `.idx` is pre-sorted)

**`extractFromZip`** — use `fflate.unzip` to extract all files. Find the `.ifo`, `.idx`, and `.dict.dz`/`.dict` files by name suffix. Throw if any are missing.

Test fixtures: create minimal binary fixtures inline in the test file using `Uint8Array` of known values.

- [ ] **Step 1: Write failing tests**

```typescript
// src/__tests__/contextTranslation/dictionaryParser.test.ts
import { describe, test, expect } from 'vitest';
import { parseIfo, parseStarDict } from '@/services/contextTranslation/dictionaryParser';

describe('parseIfo', () => {
  test('extracts bookname and wordcount', () => {
    const buf = new TextEncoder().encode('StarDict\'s dict w/ ex.\nversion=2.4.8\nbookname=testdict\nwordcount=123\nsametypesequence=m\n');
    const result = parseIfo(buf);
    expect(result.name).toBe('testdict');
    expect(result.wordcount).toBe(123);
  });

  test('throws if bookname missing', () => {
    const buf = new TextEncoder().encode('version=2.4.8\nwordcount=10\n');
    expect(() => parseIfo(buf)).toThrow();
  });
});

describe('parseStarDict', () => {
  test('parses idx entries and slices dict buffer', () => {
    // Build a minimal .idx: headword "hello\0" + offset=0 + size=5
    const idx = new Uint8Array([104,101,108,108,111,0, 0,0,0,0, 0,0,0,5]);
    // dict: "world"
    const dict = new TextEncoder().encode('world');
    const result = parseStarDict({ ifo: new Uint8Array(), idx, dict });
    expect(result).toHaveLength(1);
    expect(result[0]!.headword).toBe('hello');
    expect(result[0]!.definition).toBe('world');
  });

  test('strips HTML from definition when sametypesequence starts with h', () => {
    const ifo = new TextEncoder().encode('bookname=x\nwordcount=1\nsametypesequence=h\n');
    const idx = new Uint8Array([120,0, 0,0,0,0, 0,0,0,10]);
    const dict = new TextEncoder().encode('<b>bold</b>');
    const result = parseStarDict({ ifo, idx, dict });
    expect(result[0]!.definition).toBe('bold');
  });

  test('throws if no recognized type in sametypesequence', () => {
    const ifo = new TextEncoder().encode('bookname=x\nwordcount=1\nsametypesequence=x\n');
    const idx = new Uint8Array([120,0, 0,0,0,0, 0,0,0,5]);
    const dict = new TextEncoder().encode('hello');
    expect(() => parseStarDict({ ifo, idx, dict })).toThrow();
  });
});
```

Run: `npx vitest run src/__tests__/contextTranslation/dictionaryParser.test.ts -v`
Expected: FAIL — module not found

- [ ] **Step 2: Write parseIfo**

```typescript
// src/services/contextTranslation/dictionaryParser.ts
export function parseIfo(buffer: Uint8Array): { name: string; wordcount: number } {
  const text = new TextDecoder('utf-8', { fatal: true }).decode(buffer);
  const lines = text.split(/\r?\n/);
  const map: Record<string, string> = {};
  for (const line of lines) {
    const eq = line.indexOf('=');
    if (eq < 0) continue;
    map[line.slice(0, eq)] = line.slice(eq + 1);
  }
  const name = map['bookname'];
  const wc = map['wordcount'];
  if (!name) throw new Error('StarDict .ifo: missing bookname');
  const wordcount = wc ? parseInt(wc, 10) : 0;
  return { name, wordcount };
}
```

- [ ] **Step 3: Write parseStarDict**

```typescript
const HTML_TAG_REGEX = /<[^>]+>/g;

function stripHtml(text: string): string {
  return text.replace(HTML_TAG_REGEX, '');
}

export function parseStarDict(buffers: {
  ifo: Uint8Array;
  idx: Uint8Array;
  dict: Uint8Array;
}): DictionaryEntry[] {
  const ifoText = new TextDecoder('utf-8', { fatal: false }).decode(buffers.ifo);
  const sametypesequence = (ifoText.match(/sametypesequence=(\S+)/)?.[1] ?? 'm')[0]!;
  const firstType = sametypesequence[0]!;
  const entries: DictionaryEntry[] = [];
  const idx = buffers.idx;
  let offset = 0;
  while (offset < idx.length) {
    // read null-terminated headword
    let headwordEnd = offset;
    while (headwordEnd < idx.length && idx[headwordEnd] !== 0) headwordEnd++;
    const headword = new TextDecoder('utf-8', { fatal: false }).decode(idx.slice(offset, headwordEnd));
    offset = headwordEnd + 1; // skip null
    if (offset + 8 > idx.length) break;
    const entryOffset = (idx[offset]! << 24) | (idx[offset + 1]! << 16) | (idx[offset + 2]! << 8) | idx[offset + 3]!;
    const entrySize = (idx[offset + 4]! << 24) | (idx[offset + 5]! << 16) | (idx[offset + 6]! << 8) | idx[offset + 7]!;
    offset += 8;
    const rawDef = new TextDecoder('utf-8', { fatal: false }).decode(buffers.dict.slice(entryOffset, entryOffset + entrySize));
    let definition: string;
    if (firstType === 'h') definition = stripHtml(rawDef);
    else if (firstType === 't') definition = rawDef;
    else if (firstType === 'm') definition = rawDef;
    else throw new Error(`StarDict: unsupported sametypesequence first type '${firstType}'`);
    entries.push({ headword, definition });
  }
  return entries; // already sorted by StarDict spec
}
```

- [ ] **Step 4: Write extractFromZip**

```typescript
import { unzip } from 'fflate';

export async function extractFromZip(
  zipBuffer: Uint8Array,
): Promise<{ ifo: Uint8Array; idx: Uint8Array; dict: Uint8Array }> {
  return new Promise((resolve, reject) => {
    unzip(zipBuffer, (err, files) => {
      if (err || !files) { reject(new Error('Failed to unzip: ' + err?.message)); return; }
      const find = (suffix: string): Uint8Array | undefined => {
        for (const name of Object.keys(files)) {
          if (name.endsWith(suffix)) return files[name]!;
        }
        return undefined;
      };
      const ifo = find('.ifo');
      const idx = find('.idx');
      const dict = find('.dict.dz') ?? find('.dict');
      if (!ifo || !idx || !dict) {
        reject(new Error('StarDict zip must contain .ifo, .idx, and .dict.dz or .dict'));
        return;
      }
      // .dict.dz is dictzip (gzip) — fflate handles it directly
      resolve({ ifo, idx, dict });
    });
  });
}
```

Run: `npx vitest run src/__tests__/contextTranslation/dictionaryParser.test.ts -v`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add src/services/contextTranslation/dictionaryParser.ts src/__tests__/contextTranslation/dictionaryParser.test.ts
git commit -m "feat(context-dict): add StarDict parser — .ifo, .idx, .dict.dz parsing"
```

---

## Phase 2 — Dictionary Service

### Task 3: Dictionary service

**Files:**
- Create: `src/services/contextTranslation/dictionaryService.ts`
- Test: `src/__tests__/contextTranslation/dictionaryService.test.ts`
- Modify: `src/services/contextTranslation/popupRetrievalService.ts`
- Modify: `src/services/contextTranslation/types.ts`

The `dictionaryService.ts` module manages the full lifecycle. Key design points from the spec:

**In-memory cache:** `Map<string, DictionaryEntry[]>` keyed by dictionary `id`. Loaded lazily, cleared on delete.

**BUNDLED_DICTIONARIES manifest:** A `const` array at the top of the module, one entry per bundled dictionary. Each entry has `id`, `language`, `targetLanguage`, and `bundledVersion`.

**Ranking:** Category 1 (bilingual exact) > Category 2 (monolingual). Within same category: user-imported > bundled. Within user-imported: higher `importedAt` ranks higher.

**Lookup tiers:**
1. Exact match (always)
2. Prefix: headword starts with text (if text.length ≤ 40)
3. Prefix: text starts with headword (if text.length ≤ 40)
4. Fuzzy: Levenshtein ≤ 2 over ~200 candidates (if text.length ≤ 40)

**Result assembly:** up to 1 entry per dictionary, capped at 3 total, deduplicated by headword.

**Levenshtein:** implement inline — no external dependency needed. Classic dynamic programming O(mn) table.

**IndexedDB read/write:** Use `aiStore` to get/set records in `dictionaryData` store.

**Settings integration:** Read/write `userDictionaryMeta` via the settings store.

```typescript
// src/services/contextTranslation/dictionaryService.ts (outline)
import { parseIfo, parseStarDict, extractFromZip } from './dictionaryParser';
import { aiStore } from '@/services/ai/storage/aiStore';
import { useSettingsStore } from '@/store/settingsStore';

export interface BUNDLED_DICT {
  id: string;
  language: string;
  targetLanguage: string;
  bundledVersion: string;
}

export const BUNDLED_DICTIONARIES: BUNDLED_DICT[] = [
  { id: 'bundled-zh-en', language: 'zh', targetLanguage: 'en', bundledVersion: '1.0' },
  // ... one per bundled language
];

const memoryCache = new Map<string, DictionaryEntry[]>();

// helper: binary search on sorted DictionaryEntry[] for exact headword match
function binarySearchExact(entries: DictionaryEntry[], headword: string): number {
  let lo = 0, hi = entries.length - 1;
  while (lo <= hi) {
    const mid = (lo + hi) >>> 1;
    const cmp = entries[mid]!.headword.localeCompare(headword);
    if (cmp === 0) return mid;
    if (cmp < 0) lo = mid + 1;
    else hi = mid - 1;
  }
  return -(lo + 1); // insertion point (negative)
}

export function lookupDefinitions(
  text: string,
  sourceLang: string,
  targetLang: string,
): DictionaryEntry[] {
  // ... full implementation per spec
}
```

- [ ] **Step 1: Write failing tests**

```typescript
// src/__tests__/contextTranslation/dictionaryService.test.ts
import { describe, test, expect, vi, beforeEach } from 'vitest';
import { lookupDefinitions } from '@/services/contextTranslation/dictionaryService';

const SAMPLE_ENTRIES = [
  { headword: 'apple', definition: 'a round fruit' },
  { headword: 'apricot', definition: 'a stone fruit' },
  { headword: 'banana', definition: 'a yellow fruit' },
  { headword: '運行', definition: 'to run, operation' },
  { headword: '運動', definition: 'sports, movement' },
];

describe('lookupDefinitions — exact match', () => {
  test('returns entry when headword matches exactly', async () => {
    const results = await lookupDefinitions('apple', 'en', 'zh', SAMPLE_ENTRIES, 'en', 'en');
    expect(results[0]?.headword).toBe('apple');
  });

  test('returns nothing for non-matching headword', async () => {
    const results = await lookupDefinitions('pear', 'en', 'zh', SAMPLE_ENTRIES, 'en', 'en');
    expect(results).toHaveLength(0);
  });
});

describe('lookupDefinitions — prefix match', () => {
  test('finds headwords that start with selected text (en)', async () => {
    const results = await lookupDefinitions('appl', 'en', 'zh', SAMPLE_ENTRIES, 'en', 'en');
    expect(results.map(r => r.headword)).toContain('apple');
  });

  test('finds headwords that are prefix of selected text (cjk)', async () => {
    const results = await lookupDefinitions('運行中', 'ja', 'en', SAMPLE_ENTRIES, 'ja', 'en');
    expect(results[0]?.headword).toBe('運行');
  });
});

describe('lookupDefinitions — fuzzy', () => {
  test('finds entry within edit distance 2', async () => {
    const results = await lookupDefinitions('aplle', 'en', 'zh', SAMPLE_ENTRIES, 'en', 'en');
    expect(results[0]?.headword).toBe('apple');
  });
});

describe('lookupDefinitions — deduplication and capping', () => {
  test('deduplicates by headword', async () => {
    const duplicate = [...SAMPLE_ENTRIES, { headword: 'apple', definition: 'a fruit from apple tree' }];
    const results = await lookupDefinitions('apple', 'en', 'zh', duplicate, 'en', 'en');
    // Should have only one 'apple' entry
    const apples = results.filter(r => r.headword === 'apple');
    expect(apples).toHaveLength(1);
  });

  test('caps at 3 entries total', async () => {
    // This test is conceptual — in practice multiple dictionaries supply different headwords
    const results = await lookupDefinitions('a', 'en', 'zh', SAMPLE_ENTRIES, 'en', 'en');
    expect(results.length).toBeLessThanOrEqual(3);
  });
});
```

Run: `npx vitest run src/__tests__/contextTranslation/dictionaryService.test.ts -v`
Expected: FAIL — module not found

- [ ] **Step 2: Write dictionaryService.ts**

Write the full module. Key implementation notes:
- Use `aiStore.getRecord(store, id)` and `aiStore.putRecord(store, value)` — check the existing aiStore API first
- Settings: use `useSettingsStore.getState().settings?.globalReadSettings?.userDictionaryMeta`
- Settings write: `saveSettings(envConfig, updatedSettings)` via `saveCtxDictSetting`-pattern callback from the settings store
- Levenshtein: inline implementation
- The `lookupDefinitions` function should be a pure function in tests (accept entries array directly), but in production it loads from cache/IndexedDB. To make it testable: extract a `findMatches(entries, text)` pure function and test it directly. The full `lookupDefinitions` wraps it with cache access.

Refactor: export `findMatches(entries: DictionaryEntry[], text: string): DictionaryEntry[]` as a pure function. `lookupDefinitions` calls `findMatches` on loaded entries. Tests import `findMatches`.

```typescript
// In dictionaryService.ts:
export function findMatches(entries: DictionaryEntry[], text: string): DictionaryEntry[] {
  if (text.length === 0) return [];
  const pos = binarySearchExact(entries, text);
  const results: DictionaryEntry[] = [];
  const seenHeadwords = new Set<string>();

  // Tier 1: exact
  if (pos >= 0) {
    results.push(entries[pos]!);
    seenHeadwords.add(entries[pos]!.headword);
  }
  if (results.length >= 3) return results;

  if (text.length <= 40) {
    // Tier 2: headword starts with text
    const lo = pos >= 0 ? pos : -(pos + 1);
    for (let i = lo - 1; i >= 0; i--) {
      if (!entries[i]!.headword.startsWith(text)) break;
      if (!seenHeadwords.has(entries[i]!.headword)) {
        results.push(entries[i]!);
        seenHeadwords.add(entries[i]!.headword);
        if (results.length >= 3) return results;
      }
    }
    for (let i = lo; i < entries.length; i++) {
      if (!entries[i]!.headword.startsWith(text)) break;
      if (!seenHeadwords.has(entries[i]!.headword)) {
        results.push(entries[i]!);
        seenHeadwords.add(entries[i]!.headword);
        if (results.length >= 3) return results;
      }
    }

    // Tier 3: text starts with headword
    for (let i = 0; i < entries.length && results.length < 3; i++) {
      const hw = entries[i]!.headword;
      if (seenHeadwords.has(hw)) continue;
      if (text.startsWith(hw)) {
        results.push(entries[i]!);
        seenHeadwords.add(hw);
      }
    }

    // Tier 4: fuzzy
    const fuzzyCandidates = entries.slice(Math.max(0, -(pos + 1) - 100), Math.min(entries.length, -(pos + 1) + 100));
    for (const entry of fuzzyCandidates) {
      if (results.length >= 3) break;
      if (seenHeadwords.has(entry.headword)) continue;
      if (levenshtein(text, entry.headword) <= 2) {
        results.push(entry);
        seenHeadwords.add(entry.headword);
      }
    }
  }

  return results;
}

function levenshtein(a: string, b: string): number {
  if (a.length === 0) return b.length;
  if (b.length === 0) return a.length;
  const dp: number[][] = Array.from({ length: a.length + 1 }, (_, i) =>
    Array.from({ length: b.length + 1 }, (_, j) => (i === 0 ? j : j === 0 ? i : 0)),
  );
  for (let i = 1; i <= a.length; i++) {
    for (let j = 1; j <= b.length; j++) {
      dp[i]![j] = a[i - 1] === b[j - 1]
        ? dp[i - 1]![j - 1]!
        : 1 + Math.min(dp[i - 1]![j]!, dp[i]![j - 1]!, dp[i - 1]![j - 1]!);
    }
  }
  return dp[a.length]![b.length]!;
}
```

`lookupDefinitions` (async): load all dictionaries from IndexedDB, filter to matching ones, rank them, call `findMatches` on each, assemble results.

- [ ] **Step 3: Run tests**

Run: `npx vitest run src/__tests__/contextTranslation/dictionaryService.test.ts -v`
Expected: PASS

- [ ] **Step 4: Commit**

```bash
git add src/services/contextTranslation/dictionaryService.ts src/__tests__/contextTranslation/dictionaryService.test.ts
git commit -m "feat(context-dict): add dictionary service — import, delete, init, lookup"
```

---

## Phase 3 — Integration

### Task 4: Add dictionaryEntries to PopupContextBundle and inject into prompt

**Files:**
- Modify: `src/services/contextTranslation/types.ts` — add `dictionaryEntries: string[]` to `PopupContextBundle`
- Modify: `src/services/contextTranslation/popupRetrievalService.ts` — call `lookupDefinitions` in parallel with RAG
- Modify: `src/services/contextTranslation/promptBuilder.ts` — inject `<reference_dictionary>` block

**In `types.ts`**, add to `PopupContextBundle`:
```typescript
dictionaryEntries: string[]; // formatted "headword: definition" strings
```

**In `popupRetrievalService.ts`**, in `buildPopupContextBundle`, after the RAG retrieval block, add:

```typescript
// Parallel dictionary lookup
let dictionaryEntries: string[] = [];
try {
  const dictResults = await lookupDefinitions(
    selectedText,
    settings.targetLanguage /* source is resolved from selectedText in service */,
    settings.targetLanguage,
  );
  dictionaryEntries = dictResults.map(e => `${e.headword}: ${e.definition}`);
} catch {
  dictionaryEntries = [];
}
```

Wait — `buildPopupContextBundle` doesn't know `sourceLanguage`. Check how `contextLookupService.ts` calls it. The `sourceLanguage` is resolved in `contextLookupService.ts` before calling the prompt builder. The dictionary lookup also needs `sourceLanguage`. Options:
1. Pass `sourceLanguage` into `buildPopupContextBundle`
2. Call `lookupDefinitions` in `contextLookupService.ts` instead

Option 2 is cleaner — `buildPopupContextBundle` stays unchanged; `lookupDefinitions` is called in `contextLookupService.ts` right after getting the bundle, and the `dictionaryEntries` are added there.

In `contextLookupService.ts`, after the bundle is returned, call `lookupDefinitions(sourceLanguage, targetLanguage)` and assign the formatted entries to `bundle.dictionaryEntries` before calling `buildLookupPrompt`:

```typescript
// After: const bundle = await buildPopupContextBundle(...)
try {
  const dictResults = await lookupDefinitions(
    request.selectedText,
    request.sourceLanguage ?? 'en', // sourceLanguage from the request
    request.targetLanguage,
  );
  bundle.dictionaryEntries = dictResults.map(e => `${e.headword}: ${e.definition}`);
} catch {
  bundle.dictionaryEntries = [];
}
```

In `promptBuilder.ts`, add to `buildContextSections`:

```typescript
if (request.popupContext.dictionaryEntries.length > 0) {
  parts.push(`<reference_dictionary>\n${request.popupContext.dictionaryEntries.join('\n')}\n</reference_dictionary>`);
}
```

And in the system prompt template in `promptBuilder.ts`, add to **both** `buildTranslationPrompt` and `buildDictionaryPrompt`:
```
If a <reference_dictionary> block is present, use it as an authoritative reference. Do not contradict it without strong contextual reason.
```

- [ ] **Step 1: Write failing test — promptBuilder injects block when entries present**

Before writing the test, update the existing `emptyPopupContext()` fixture used by all tests in `promptBuilder.test.ts` to include `dictionaryEntries: []`. This prevents all existing tests from breaking when the new field is added to the type. Then write the new failing test.

```typescript
// Update emptyPopupContext() in promptBuilder.test.ts:
function emptyPopupContext(): PopupContextBundle {
  return {
    localPastContext: '',
    localFutureBuffer: '',
    sameBookChunks: [],
    priorVolumeChunks: [],
    retrievalStatus: 'local-only',
    retrievalHints: { currentVolumeIndexed: false, missingLocalIndex: false, missingPriorVolumes: [], missingSeriesAssignment: false },
    dictionaryEntries: [], // ← add this field
  };
}
```

Then write the new failing test:

```typescript
test('buildTranslationPrompt injects reference_dictionary block when dictionaryEntries provided', () => {
  const req = makeTranslationRequest({
    popupContext: {
      ...emptyPopupContext(),
      dictionaryEntries: ['apple: a round fruit', 'apples: plural of apple'],
    },
  });
  const { userPrompt } = buildTranslationPrompt(req);
  expect(userPrompt).toContain('<reference_dictionary>');
  expect(userPrompt).toContain('apple: a round fruit');
});

test('buildTranslationPrompt omits reference_dictionary block when dictionaryEntries is empty', () => {
  const req = makeTranslationRequest({
    popupContext: { ...emptyPopupContext(), dictionaryEntries: [] },
  });
  const { userPrompt } = buildTranslationPrompt(req);
  expect(userPrompt).not.toContain('reference_dictionary');
});
```

Run: `npx vitest run src/__tests__/contextTranslation/promptBuilder.test.ts -v`
Expected: FAIL — `dictionaryEntries` not in PopupContextBundle type

- [ ] **Step 2: Add dictionaryEntries to PopupContextBundle type**

- [ ] **Step 3: Call lookupDefinitions in contextLookupService.ts**

- [ ] **Step 4: Update buildContextSections to inject the block**

- [ ] **Step 5: Update system prompt template**

Run: `npx vitest run src/__tests__/contextTranslation/promptBuilder.test.ts -v`
Expected: PASS

- [ ] **Step 6: Commit**

```bash
git add src/services/contextTranslation/types.ts src/services/contextTranslation/contextLookupService.ts src/services/contextTranslation/promptBuilder.ts
git commit -m "feat(context-dict): inject dictionary entries into prompt via <reference_dictionary> block"
```

---

## Phase 4 — Settings UI

### Task 5: Dictionaries section in AIPanel

**Files:**
- Modify: `src/components/settings/AIPanel.tsx`
- Modify: `src/__tests__/components/settings/AIPanel.test.tsx`

Add a "Dictionaries" section to AIPanel, below the existing "Dictionary Lookup" card. Two sub-sections:

**Bundled:** Read-only list rendered from `BUNDLED_DICTIONARIES` constant (imported from `dictionaryService.ts`). Each row: language name, entry count ("N entries"), status icon (✓).

**User dictionaries:** List from `userDictionaryMeta` in settings. Each row: name, source→target language pair, entry count, delete button. "Add Dictionary" button triggers:
- On Tauri: `openDialog` (native file picker, `.zip` filter)
- On Web: `<input type="file" accept=".zip">` with `display: none`, clicked programmatically

**Import modal:** After file selection, call `previewDictionaryZip` (Phase 1: parse `.ifo` only). Show modal with Name (pre-filled), Source language dropdown, Target language dropdown ("Same as source" option). "Confirm" calls `importUserDictionary`. On success: dismiss modal, dictionary appears in list. On failure: show error inline.

**State needed in AIPanel:**
- `importing: boolean` — show spinner on button
- `importError: string | null` — show error message
- `showModal: boolean` — control modal visibility
- `importPreview: { name: string; wordcount: number } | null` — from preview phase

Also add a `dictionaryUnavailableBanner: boolean` state — set to `true` if `initBundledDictionaries()` throws. Show a dismissible warning banner above the section.

- [ ] **Step 1: Write failing test — renders Dictionaries section**

```typescript
test('renders Dictionaries section with bundled and user sections', () => {
  render(<AIPanel />);
  expect(screen.getByText('Dictionaries')).toBeTruthy();
  expect(screen.getByText('Bundled Dictionaries')).toBeTruthy();
  expect(screen.getByText('User Dictionaries')).toBeTruthy();
});
```

Run: `npx vitest run src/__tests__/components/settings/AIPanel.test.tsx -v`
Expected: FAIL — "Dictionaries" text not found

- [ ] **Step 2: Implement Dictionaries section**

Add the section to AIPanel. Use the same card/divide pattern as the existing cards.

- [ ] **Step 3: Mock dictionaryService in tests**

```typescript
vi.mock('@/services/contextTranslation/dictionaryService', () => ({
  BUNDLED_DICTIONARIES: [
    { id: 'b-zh', language: 'zh', targetLanguage: 'en', bundledVersion: '1.0' },
  ],
  previewDictionaryZip: vi.fn().mockResolvedValue({ name: 'CC-CEDICT', wordcount: 100 }),
  importUserDictionary: vi.fn().mockResolvedValue({ id: 'u-1', name: 'CC-CEDICT', language: 'zh', targetLanguage: 'en', entryCount: 100, source: 'user', importedAt: Date.now() }),
  deleteUserDictionary: vi.fn().mockResolvedValue(undefined),
  initBundledDictionaries: vi.fn().mockResolvedValue(undefined),
}));
```

Update mock in `AIPanel.test.tsx` to include dictionaryService mocks. Add `userDictionaryMeta` to the mock settings store state.

- [ ] **Step 4: Run tests**

Run: `npx vitest run src/__tests__/components/settings/AIPanel.test.tsx -v`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add src/components/settings/AIPanel.tsx src/__tests__/components/settings/AIPanel.test.tsx
git commit -m "feat(context-dict): add Dictionaries section to AI settings panel"
```

---

## Phase 5 — Build Script and Bundled Dictionaries

### Task 6: Build script

**Files:**
- Create: `scripts/dictionaries/build.mjs` (plain ESM JavaScript, no TypeScript imports)

A Node.js script (Node 18+, uses built-in `fetch`) that downloads each source dictionary, parses it, and writes a gzipped JSON blob to `public/dictionaries/`.

```javascript
// scripts/dictionaries/build.mjs
// Node.js 18+ built-in fetch — no external dependencies needed
import { writeFileSync, mkdirSync } from 'node:fs';
import { createGzip } from 'node:zlib';
import { Readable } from 'node:stream';
import { pipeline } from 'node:stream/promises';
import { promisify } from 'node:util';
import { execSync } from 'node:child_process';

const gzip = promisify(createGzip);

const SOURCES = [
  // CC-CEDICT: plain text, one line per entry:
  // traditional simplified [pinyin] /definitions/
  { id: 'bundled-zh-en', language: 'zh', targetLanguage: 'en',
    async parseEntries() {
      // Download and stream-parse
      const url = 'https://www.mdbg.net/chinese/dictionary/files/cedict/cedict_1_0_ci.txt';
      const res = await fetch(url);
      const text = await res.text();
      const entries = [];
      for (const line of text.split('\n')) {
        if (line.startsWith('#') || !line.trim()) continue;
        const m = line.match(/^(\S+)\s+(\S+)\s+\[([^\]]+)\]\s+\/(.+)\//);
        if (!m) continue;
        entries.push({ headword: m[2], definition: `${m[3]} /${m[4]}/` });
      }
      return entries;
    }
  },
  // JMdict: XML — use streaming parser (node-stream)
  { id: 'bundled-ja-en', language: 'ja', targetLanguage: 'en',
    async parseEntries() { /* ...streaming XML parse... */ }
  },
];

async function build() {
  mkdirSync('public/dictionaries', { recursive: true });
  for (const src of SOURCES) {
    console.log(`Building ${src.id}...`);
    const entries = await src.parseEntries();
    const json = JSON.stringify(entries);
    const compressed = await gzip(Buffer.from(json));
    writeFileSync(`public/dictionaries/${src.id}.json.gz`, compressed);
    console.log(`  -> ${entries.length} entries, ${(compressed.length / 1024).toFixed(1)} KB`);
  }
}

build().catch(e => { console.error(e); process.exit(1); });
```

Note: The script uses Node.js built-in modules only (`fetch`, `zlib`, `fs`, `stream`). No TypeScript imports, no `tsx`, no `node-fetch`. Use `tsx scripts/dictionaries/build.mjs` to run it only if needed.

- [ ] **Step 1: Write build.mjs**

Download CC-CEDICT (plain text, ~10MB). Each line: `traditional simplified [pinyin] /definitions/`. Parse headword = first token (traditional), second token (simplified if different). Definition = content between `/` slashes. Write gzip.

For JMdict: download XML, parse with a streaming approach (or simple string split for MVP). Output is gzip JSON.

Output to `public/dictionaries/[id].json.gz`.

- [ ] **Step 2: Run the build script**

```bash
node scripts/dictionaries/build.mjs
```

Check that `public/dictionaries/` contains gzipped JSON files.

- [ ] **Step 3: Commit build script and placeholder stubs**

For initial implementation, create realistic stub fixture data (a handful of entries per language) rather than attempting real downloads. This keeps the task bounded. Commit placeholder files:

```bash
# Create minimal stub files for each language (2-3 entries each)
echo '[]' | gzip > public/dictionaries/bundled-zh-en.json.gz
echo '[]' | gzip > public/dictionaries/bundled-ja-en.json.gz
# etc.
git add public/dictionaries/
git commit -m "feat(context-dict): add bundled dictionary placeholder directory"
```

Real dictionary downloads can be a follow-up step once the pipeline is verified.

- [ ] **Step 4: Commit build script**

```bash
git add scripts/dictionaries/build.mjs
git commit -m "feat(context-dict): add build script for bundled dictionaries"
```

---

## Phase 6 — Wire init and final integration

### Task 7: Wire init at app startup and finalize imports

**Files:**
- Modify: `src/app/layout.tsx` or the app initialization entry point

Call `initBundledDictionaries()` once when the app starts. Find the existing app initialization code (look for `useEffect` in the root layout or a dedicated `AppInit` component).

```typescript
// In AppInit component:
useEffect(() => {
  initBundledDictionaries().catch(() => {
    // set dictionaryUnavailableBanner = true
  });
}, []);
```

Also wire the file picker import flow in AIPanel: call `previewDictionaryZip` → show modal → call `importUserDictionary`.

- [ ] **Step 1: Find app init entry point and add initBundledDictionaries call**

```typescript
// In AppInit or root layout:
import { initBundledDictionaries } from '@/services/contextTranslation/dictionaryService';
import { useSettingsStore } from '@/store/settingsStore';

const [dictBannerDismissed, setDictBannerDismissed] = useState(false);
const [dictUnavailable, setDictUnavailable] = useState(false);

useEffect(() => {
  initBundledDictionaries()
    .then(() => setDictUnavailable(false))
    .catch(() => setDictUnavailable(true));
}, []);
```

- [ ] **Step 2: Run full test suite**

```bash
pnpm test --run 2>&1 | tail -20
```

Expected: all tests pass (or pre-existing failures only)

- [ ] **Step 3: Commit**

```bash
git commit -m "feat(context-dict): wire bundled dictionary init at app startup"
```

---

## Summary of All Commits

1. `feat(context-dict): add DictionaryEntry/UserDictionary types, bump IndexedDB schema to v5`
2. `feat(context-dict): add StarDict parser — .ifo, .idx, .dict.dz parsing`
3. `feat(context-dict): add dictionary service — import, delete, init, lookup`
4. `feat(context-dict): inject dictionary entries into prompt via <reference_dictionary> block`
5. `feat(context-dict): add Dictionaries section to AI settings panel`
6. `feat(context-dict): add build script for bundled dictionaries`
7. `feat(context-dict): wire bundled dictionary init at app startup`

## Open Questions to Resolve During Implementation

1. **Where exactly does `initBundledDictionaries` get called?** Check `src/app/layout.tsx` or equivalent for the app's initialization entry point.
2. **aiStore `putRecord`/`getRecord` API** — verify the exact method names and signatures before writing the service.
3. **Settings write pattern** — confirm the correct API for writing to `userDictionaryMeta` in settings (check how `saveCtxDictSetting` works).
4. **Whether stub fixture data is sufficient for Phase 5** — or whether real downloads should be attempted.
