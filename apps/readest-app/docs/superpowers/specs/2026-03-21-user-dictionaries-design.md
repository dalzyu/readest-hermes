# User Dictionary RAG — Design Spec

**Date:** 2026-03-21
**Status:** Approved

## Overview

Allow users to use their own StarDict dictionaries alongside bundled open-source dictionaries for common languages. When a user selects text in the reader, relevant dictionary entries are automatically looked up and injected into the AI prompt as grounding context, improving translation and dictionary lookup quality — especially for ambiguous terms, idioms, and technical vocabulary. The feature is invisible to the user during reading; dictionary entries appear in the AI prompt, not in the popup UI.

---

## Goals

- Ship bundled open-source dictionaries for 10 common languages so the feature works out of the box with no setup.
- Allow users to import additional StarDict dictionaries as `.zip` files.
- Inject up to 3 matching dictionary entries into both translation mode and dictionary mode AI prompts.
- Work on both Tauri (desktop) and web platforms without separate code paths.

## Non-Goals

- Showing raw dictionary entries in the popup UI (prompt injection only).
- Tokenising long selections to look up individual words (exact match handles full phrases; fuzzy only for short text).
- Supporting dictionary formats other than StarDict.

---

## Data Model

### `DictionaryEntry`
```typescript
interface DictionaryEntry {
  headword: string;
  definition: string; // plain text extracted from StarDict
}
```

### `UserDictionary`
```typescript
interface UserDictionary {
  id: string;           // uuid
  name: string;         // from StarDict .ifo bookname field
  language: string;     // ISO 639-1 source language (headword language), e.g. 'zh'
  targetLanguage: string; // ISO 639-1 definition language; same as language for monolingual
  entryCount: number;
  source: 'bundled' | 'user';
  importedAt: number;
  /** Only present when source === 'bundled'. Checked against BUNDLED_DICTIONARIES
   *  version to detect when a committed .json.gz has been updated in the repo. */
  bundledVersion?: string;
}
```

### IndexedDB Store

A new store `dictionaryData` is added to the existing `readest-ai` IndexedDB database (bumping schema version). Each record has key `id` (matching `UserDictionary.id`) and value `{ meta: UserDictionary, blob: Uint8Array }` where `blob` is gzip-compressed JSON of `DictionaryEntry[]`.

### Metadata Separation

**User-imported dictionaries** are listed in `settings.json` under `userDictionaryMeta: UserDictionary[]` (alongside `customFonts`). This is user data that must be preserved across app updates and synced.

**Bundled dictionaries** are not written to `settings.json`. Their metadata is derived at runtime from the compile-time constant `BUNDLED_DICTIONARIES: UserDictionary[]` in `dictionaryService.ts`, and their presence in IndexedDB is checked against a versioned manifest constant rather than settings. This avoids dirtying `settings.json` on every fresh install and prevents bundled/user metadata from being conflated.

### In-Memory Lookup Structure

The in-memory cache is `Map<string, DictionaryEntry[]>` keyed by `id`. Each `DictionaryEntry[]` is kept **sorted by `headword` ascending** (StarDict `.idx` is already sorted; this order is preserved through parse and storage). Binary search operates directly on this sorted array comparing `headword` fields. This is defined and used consistently throughout.

### In-Memory Cache

Populated lazily on first lookup per dictionary, persisted for the session. Cache entries are removed synchronously when a dictionary is deleted.

---

## StarDict Parser (`dictionaryParser.ts`)

Users upload a `.zip` file. A two-phase flow handles the import:

**Phase 1 — Quick parse (`.ifo` only):** Unzip and read the `.ifo` file to extract `bookname`, `wordcount`, and `sametypesequence`. Return these to the import modal so the user can review/correct metadata before the expensive full parse.

**Phase 2 — Full parse (after modal confirmation):** Triggered by `importUserDictionary` with the confirmed metadata.

### File Components
- `.ifo` — plaintext metadata (`bookname`, `wordcount`, `sametypesequence`)
- `.idx` — binary headword index: repeated `headword\0` (null-terminated UTF-8) + 4-byte big-endian offset + 4-byte big-endian size
- `.dict.dz` or `.dict` — dictzip-compressed or raw definitions

### dictzip Note

StarDict `.dict.dz` files use the dictzip format, which is a valid gzip stream with a chunked offset table embedded in the gzip extra field. `fflate` can decompress dictzip files as regular gzip streams (the extra metadata is ignored and full decompression proceeds normally). This has been verified to work. Full decompression is used rather than random-access seeking since we process all entries at import time.

### Parse Pipeline

1. **Unzip** — use `fflate` to extract all files from the zip in-renderer.
2. **Parse `.ifo`** — read `bookname`, `wordcount`, `sametypesequence`.
3. **Parse `.idx`** — iterate null-terminated headwords + 8-byte offset/size pairs → `Array<{headword, offset, size}>` (StarDict spec guarantees this is sorted by headword).
4. **Decompress `.dict.dz` / read `.dict`** — fully decompress with `fflate`; produces flat byte buffer. Slice each entry by `offset + size`, decode as UTF-8.
5. **Handle `sametypesequence`** — iterate type characters in the sequence; take the value of the first recognized type (`m` = plain text, `h` = HTML with tags stripped, `t` = phonetic string, treated as plain text). Skip unrecognized types. Concatenate nothing from fields after the first recognized one (YAGNI — multi-field sequences are rare in practice and this keeps definitions clean).
6. **Output** — `DictionaryEntry[]` sorted by headword, then gzip-compressed as `Uint8Array` for storage.

For **bundled dictionaries**, this pipeline runs at build time via `scripts/dictionaries/build.mjs`. Source dictionaries are downloaded from their official URLs, parsed into `DictionaryEntry[]`, gzip-compressed, and emitted to `public/dictionaries/[lang]-[targetLang].json.gz`. These outputs are committed to the repo.

### Import Validation

A parse result with 0 entries is treated as an **import failure** (not a silent success), consistent with the rule that no partial state is written. The user sees a clear error message. This covers both corrupted `.idx`/`.dict.dz` and `sametypesequence` values where no recognized type is found.

---

## Dictionary Service (`dictionaryService.ts`)

### `previewDictionaryZip(zipFile: File | Uint8Array): Promise<{ name: string; wordcount: number }>`

Phase 1 parse: unzips and reads `.ifo` only. Returns `name` and `wordcount` for the import modal. Throws if `.ifo` is missing or unparseable.

### `importUserDictionary(zipFile: File | Uint8Array, meta: Pick<UserDictionary, 'name' | 'language' | 'targetLanguage'>): Promise<UserDictionary>`

Phase 2: full parse. On 0-entry result, throws with a user-visible error; no state is written. On success, writes to IndexedDB `dictionaryData`, appends to `userDictionaryMeta` in settings, and primes the in-memory cache.

### `deleteUserDictionary(id: string): Promise<void>`

Removes the record from IndexedDB, removes the entry from `userDictionaryMeta` in settings, and removes the in-memory cache entry.

### `initBundledDictionaries(): Promise<void>`

Called once at app startup. Compares `BUNDLED_DICTIONARIES` manifest against IndexedDB (by `id`). For any entry where the stored `bundledVersion` does not match the manifest constant, the stale IndexedDB record is replaced by re-fetching the updated `public/dictionaries/*.json.gz`. For entries missing from IndexedDB entirely, fetches and stores them. Fetches via `fetch()` from the app's own origin (Tauri asset protocol or web deployment, not a third-party server). If fetch fails (offline on web), the dictionary is skipped for this run and retried next startup.

### `lookupDefinitions(text: string, sourceLang: string, targetLang: string): Promise<DictionaryEntry[]>`

**Dictionary selection** — filter to dictionaries where:
1. `language === sourceLang` AND `targetLanguage === targetLang` — bilingual exact match
2. `language === sourceLang` AND `targetLanguage === sourceLang` — monolingual

Category 1 ranks above category 2. Within the same category, **user-imported dictionaries rank above bundled ones** — the user's custom definition takes precedence over the bundled default. Within user-imported dictionaries, more recently imported ranks higher (higher `importedAt`). Dictionaries with a mismatched `targetLanguage` (neither targetLang nor sourceLang) are excluded entirely.

For **dictionary mode** (where `targetLang === sourceLang`), categories 1 and 2 collapse into the same set; monolingual dictionaries naturally dominate.

**Lookup strategy per dictionary** (applied to each matching dictionary in rank order):

1. **Exact match** — binary search on the sorted `DictionaryEntry[]` for `headword === text`. Always attempted regardless of text length.

2. **Prefix — headword starts with text** — `headword.startsWith(text)`; only if `text.length <= 40`. Scan outward from binary search landing position in both directions (left and right) until the headword prefix no longer matches `text`. Note: for CJK dictionaries, Unicode sort order does not group by radical or phonetic similarity, so the matched block may be scattered and the scan may need to traverse a large portion of the array. This is an acceptable performance limitation for large CJK dictionaries.

3. **Prefix — text starts with headword** — `text.startsWith(headword)`; only if `text.length <= 40`. Same bidirectional scan approach. Useful for CJK: selecting "苹果汁" returns the "苹果" entry when "苹果汁" is not itself a headword. For CJK this scan is typically more relevant than direction 2 since compound words are common.
4. **Fuzzy fallback** — Levenshtein distance ≤ 2 over the 200 candidates nearest the binary search position. Only if `text.length <= 40`. This is a best-effort heuristic: lexicographic neighbors cover single-character substitutions and transpositions near the sort position but do not guarantee coverage for all edit-distance-2 pairs (e.g. "colour"/"color" may not be adjacent). Acceptable for the intended use case of handling minor typos and diacritics variations.

**Result assembly** — up to 1 matching entry per dictionary, taken in rank order, capped at 3 total. Deduplicated by headword: if a headword appears in multiple dictionaries, only the first (highest-ranked) definition is used. Returns `[]` if no match found in any dictionary.

**Formatting** — `contextAssembler.ts` calls `lookupDefinitions` and converts the returned `DictionaryEntry[]` to `string[]` formatted as `"headword: definition"` before placing them in `PopupContextBundle.dictionaryEntries`. Formatting happens at this layer so `lookupDefinitions` remains testable with structured output.

---

## Prompt Injection

`lookupDefinitions` is called inside `contextAssembler.ts` in parallel with RAG retrieval — no added latency on the hot path.

`PopupContextBundle` gains:
```typescript
dictionaryEntries: string[]; // formatted "headword: definition" strings
```

`promptBuilder.ts` `buildContextSections()` appends (when non-empty):
```xml
<reference_dictionary>
苹果: /apple/CL:個|个[gè],顆|颗[kē]/
</reference_dictionary>
```

The block is omitted entirely when `dictionaryEntries` is empty. The system prompt gains one line:
> If a `<reference_dictionary>` block is present, use it as an authoritative reference to ground your translation and explanation. Do not contradict it without strong contextual reason.

---

## Bundled Dictionaries

Shipped in `public/dictionaries/`, built by `scripts/dictionaries/build.mjs`, committed to the repo. All are bilingual (source → English).

| Language | Source | License | Est. size (gzipped) |
|----------|--------|---------|---------------------|
| Chinese (zh) | CC-CEDICT | CC BY-SA 4.0 | ~1.5 MB |
| Japanese (ja) | JMdict | CC BY-SA 4.0 | ~3 MB |
| German (de) | FreeDict deu-eng | GPL | ~0.5 MB |
| French (fr) | FreeDict fra-eng | GPL | ~0.3 MB |
| Spanish (es) | FreeDict spa-eng | GPL | ~0.3 MB |
| Portuguese (pt) | FreeDict por-eng | GPL | ~0.2 MB |
| Italian (it) | FreeDict ita-eng | GPL | ~0.2 MB |
| Russian (ru) | FreeDict rus-eng | GPL | ~0.3 MB |
| Arabic (ar) | FreeDict ara-eng | GPL | ~0.3 MB |
| Korean (ko) | KDict | CC BY | ~0.4 MB |

Total: ~7 MB. Monolingual bundled dictionaries may be added in a future iteration.

**Build script:** `scripts/dictionaries/build.mjs` downloads source files from their canonical URLs and parses them. A CI check re-runs the script in `--verify` mode (parse sources, diff against committed outputs) to catch drift between sources and committed artifacts. Dictionary sources change infrequently; CI failure alerts maintainers to regenerate and recommit.

---

## Settings UI

A new "Dictionaries" section in `AIPanel.tsx` below the "Dictionary Lookup" card.

**Bundled sub-section** — read-only list: language name, entry count, status (✓ ready / spinner during first-run init). No user actions.

**User dictionaries sub-section** — list of user-imported dictionaries: name, source language, target language, entry count, delete button. An "Add Dictionary" button:
- **Tauri:** native file dialog filtered to `.zip`
- **Web:** `<input type="file" accept=".zip">` fallback

**Import flow:**
1. User selects zip → `previewDictionaryZip` runs (fast, `.ifo` only) → import modal appears
2. Modal shows: **Name** (pre-filled from bookname), **Source language** (dropdown), **Target language** (dropdown with "Same as source" option)
3. User confirms → `importUserDictionary` runs with full parse → progress indicator shown
4. On success: dictionary appears in list immediately
5. On failure (0 entries or parse error): error message shown, no state written

A note below both lists: *"Dictionaries automatically ground AI lookups — no action needed while reading."*

---

## File Layout

```
src/services/contextTranslation/
  dictionaryParser.ts         — StarDict zip parse pipeline (both phases)
  dictionaryService.ts        — import, delete, init, lookup, cache, BUNDLED_DICTIONARIES constant
src/services/ai/storage/
  aiStore.ts                  — add dictionaryData store (schema version bump)
src/types/settings.ts         — add userDictionaryMeta: UserDictionary[]
src/services/contextTranslation/types.ts  — DictionaryEntry, UserDictionary interfaces
src/services/contextTranslation/contextAssembler.ts  — parallel dict lookup + formatting
src/services/contextTranslation/promptBuilder.ts     — inject <reference_dictionary> block
public/dictionaries/
  zh-en.json.gz
  ja-en.json.gz
  de-en.json.gz
  fr-en.json.gz
  es-en.json.gz
  pt-en.json.gz
  it-en.json.gz
  ru-en.json.gz
  ar-en.json.gz
  ko-en.json.gz
scripts/dictionaries/
  build.mjs                   — downloads sources, parses, emits public/dictionaries/
src/__tests__/contextTranslation/
  dictionaryParser.test.ts
  dictionaryService.test.ts
```

---

## Error Handling

| Condition | Behaviour |
|-----------|-----------|
| Malformed zip / missing `.ifo` | `previewDictionaryZip` throws; user sees error; no state written |
| Parse produces 0 entries | `importUserDictionary` throws; user sees error; no state written |
| Corrupted `.idx`/`.dict.dz` | Parser throws; treated as 0-entry failure |
| IndexedDB unavailable | `initBundledDictionaries` and `importUserDictionary` fail silently; `lookupDefinitions` returns `[]`. A non-blocking warning banner is shown in the Dictionaries Settings section: *"Dictionary lookup unavailable — storage is full or blocked."* The banner is dismissible. |
| Bundled dict fetch fails (web, offline) | Dictionary skipped for this session; retried next startup |
| Dictionary deleted mid-session | Cache entry removed immediately; subsequent lookups skip that dictionary |

---

## Testing

- `dictionaryParser.test.ts` — `.ifo` parsing, `.idx` binary parsing with fixture buffers, `.dict.dz` decompression, HTML stripping, multi-type `sametypesequence` (first recognized field taken), malformed input throws, 0-entry result throws
- `dictionaryService.test.ts` — category 1 vs 2 selection, mismatched-target exclusion, user-over-bundled ranking, deduplication by headword, exact/prefix-headword/prefix-text/fuzzy tiers, length gating (>40 chars skips prefix+fuzzy), 0 entries returns `[]`
- `AIPanel.test.tsx` — Dictionaries section renders, import modal shows pre-filled fields, delete button present
- `promptBuilder.test.ts` — `<reference_dictionary>` block injected when entries present, omitted when empty, system prompt instruction present
