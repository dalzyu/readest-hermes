# Context Translation RAG And Series Implementation Plan

> **For agentic workers:** REQUIRED: Use superpowers:subagent-driven-development (if subagents available) or superpowers:executing-plans to implement this plan. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Upgrade the context-translation popup to use bounded local context, same-book hybrid RAG from earlier pages, prior-volume hybrid RAG from earlier ordered series volumes, retrieval-status UX, and an `Ask About This` handoff into the existing notebook AI chat while adding a dedicated `My Series` library surface.

**Architecture:** Keep the current popup/chat split, but introduce a popup-specific context assembly pipeline that produces a structured retrieval bundle. Reuse the existing hybrid RAG primitives for both popup and chat, add strict page/volume eligibility boundaries for spoiler control, and evolve the current `Series` persistence model into an ordered volume model that powers both popup retrieval and a dedicated `My Series` management flow.

**Tech Stack:** React 19, TypeScript, Zustand, IndexedDB, Lunr, Vercel AI SDK, `pinyin-pro`, Vitest, existing Readest library and notebook surfaces.

---

## Execution Notes

- All `test` and `build` commands in this plan must be run against `apps/readest-app`, not the monorepo root.
- Use `corepack pnpm --dir apps/readest-app ...` for every runnable command in this plan.
- For legacy series rows that still store `bookHashes: string[]`, migrate in place by preserving stored order and converting them to `volumes` with:
  - `volumeIndex = 1..n`
  - `label = Vol. <n>`
- Series migration must be eager: add an explicit sweep that rewrites every legacy row during store initialization or first series-load, not only when a specific row is read indirectly.
- For `Ask About This`, seed the notebook thread by writing the full popup context bundle into the first user message content. Do not rely on metadata-only transport for the first implementation.
- Retire the old metadata-driven `groupBy=series` library path in favor of the dedicated `My Series` surface. Do not maintain two separate series concepts in the library UI.
- Use a plain labeled text block for the first `Ask About This` message. Do not use XML tags or metadata-only transport for the notebook handoff.

## File Structure

- Modify: `apps/readest-app/src/services/contextTranslation/types.ts`
  - Extend popup settings, retrieval status, context bundle types, and ordered series types.
- Modify: `apps/readest-app/src/services/contextTranslation/defaults.ts`
  - Add defaults for look-ahead words and popup RAG limits.
- Modify: `apps/readest-app/src/components/settings/AIPanel.tsx`
  - Add separate popup retrieval controls for same-book and prior-volume RAG.
- Modify: `apps/readest-app/src/services/contextTranslation/pageContextService.ts`
  - Replace simple page-window extraction with selection-truncated past context plus bounded future buffer extraction.
- Modify: `apps/readest-app/src/services/contextTranslation/contextAssembler.ts`
  - Promote it from simple recent-context helper to structured popup context assembly.
- Modify: `apps/readest-app/src/services/contextTranslation/seriesService.ts`
  - Replace the loose sibling-series helpers with ordered-volume series APIs, indexing helpers, and import suggestion support.
- Create: `apps/readest-app/src/services/contextTranslation/popupRetrievalService.ts`
  - Encapsulate same-book bounded hybrid retrieval, prior-volume bounded hybrid retrieval, and retrieval status calculation.
- Modify: `apps/readest-app/src/services/contextTranslation/promptBuilder.ts`
  - Accept structured popup context sections instead of one flat RAG blob.
- Modify: `apps/readest-app/src/hooks/useContextTranslation.ts`
  - Load the structured popup context bundle, expose retrieval status, and preserve streaming behavior.
- Modify: `apps/readest-app/src/app/reader/components/annotator/ContextTranslationPopup.tsx`
  - Render retrieval-status chip and info icon, and add the `Ask About This` handoff button.
- Modify: `apps/readest-app/src/app/reader/hooks/useOpenAIInNotebook.ts`
  - Support creating seeded conversations for popup follow-up chat.
- Modify: `apps/readest-app/src/store/aiChatStore.ts`
  - Add a helper for creating a conversation and appending a first seeded user message in one flow.
- Modify: `apps/readest-app/src/services/ai/ragService.ts`
  - Add bounded same-book hybrid retrieval primitives that can exclude page ranges.
- Modify: `apps/readest-app/src/services/ai/storage/aiStore.ts`
  - Add bounded hybrid search helpers and persist the richer ordered series schema.
- Modify: `apps/readest-app/src/services/ai/adapters/TauriChatAdapter.ts`
  - Accept popup-seeded context as an optional retrieval override without breaking normal chat.
- Modify: `apps/readest-app/src/services/ai/prompts.ts`
  - Add a variant for popup-seeded chat context sections.
- Modify: `apps/readest-app/src/app/library/components/Bookshelf.tsx`
  - Add the `My Books` / `My Series` bottom switch and load the dedicated series surface.
- Modify: `apps/readest-app/src/app/library/page.tsx`
  - Present import-time series suggestions after books are imported.
- Modify: `apps/readest-app/src/app/library/components/LibraryHeader.tsx`
  - Route import flows through the new post-import suggestion handling without changing existing import entry points.
- Modify: `apps/readest-app/src/app/library/components/ImportMenu.tsx`
  - Preserve import entry points while allowing the post-import suggestion flow to run.
- Modify: `apps/readest-app/src/app/library/components/BookshelfItem.tsx`
  - Redirect series actions into the new `My Series` flow.
- Modify: `apps/readest-app/src/app/library/components/SeriesModal.tsx`
  - Rework into ordered-series management with per-volume status and `Index All`.
- Create: `apps/readest-app/src/app/library/components/SeriesShelf.tsx`
  - Render the dedicated `My Series` view.
- Create: `apps/readest-app/src/app/library/components/SeriesCard.tsx`
  - Show one series, its ordered volumes, and indexing status summary.
- Modify or Create tests under:
  - `apps/readest-app/src/__tests__/contextTranslation/*`
  - `apps/readest-app/src/__tests__/ai/*`
  - `apps/readest-app/src/__tests__/components/*`
  - `apps/readest-app/src/__tests__/app/library/*`

## Chunk 1: Data Model And Settings

### Task 1: Extend popup settings and series types

**Files:**
- Modify: `apps/readest-app/src/services/contextTranslation/types.ts`
- Modify: `apps/readest-app/src/services/contextTranslation/defaults.ts`
- Modify: `apps/readest-app/src/components/settings/AIPanel.tsx`
- Test: `apps/readest-app/src/__tests__/contextTranslation/defaults.test.ts`
- Test: `apps/readest-app/src/__tests__/components/settings/AIPanel.test.tsx`

- [ ] **Step 1: Write the failing tests**

```ts
test('provides defaults for look-ahead and popup rag limits', () => {
  expect(DEFAULT_CONTEXT_TRANSLATION_SETTINGS.lookAheadWords).toBe(80);
  expect(DEFAULT_CONTEXT_TRANSLATION_SETTINGS.sameBookChunkCount).toBeGreaterThan(0);
  expect(DEFAULT_CONTEXT_TRANSLATION_SETTINGS.priorVolumeChunkCount).toBeGreaterThan(0);
});

test('provides separate toggles for same-book and prior-volume rag', () => {
  expect(DEFAULT_CONTEXT_TRANSLATION_SETTINGS.sameBookRagEnabled).toBe(true);
  expect(DEFAULT_CONTEXT_TRANSLATION_SETTINGS.priorVolumeRagEnabled).toBe(true);
});

test('supports ordered series volumes in the context translation model', () => {
  const series: BookSeries = {
    id: 'series-1',
    name: 'The Grey Castle',
    volumes: [
      { bookHash: 'vol-1', volumeIndex: 1, label: 'Vol. 1' },
      { bookHash: 'vol-2', volumeIndex: 2, label: 'Vol. 2' },
    ],
    createdAt: 1,
    updatedAt: 1,
  };

  expect(series.volumes[1]?.volumeIndex).toBe(2);
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `corepack pnpm --dir apps/readest-app test -- --watch=false src/__tests__/contextTranslation/defaults.test.ts`
Expected: FAIL because the current settings and series model do not expose the new fields.

- [ ] **Step 3: Write the minimal implementation**

Update `types.ts` to add focused popup retrieval types:

```ts
export type RetrievalStatus = 'local-only' | 'local-volume' | 'cross-volume';

export interface BookSeriesVolume {
  bookHash: string;
  volumeIndex: number;
  label?: string;
}

export interface BookSeries {
  id: string;
  name: string;
  volumes: BookSeriesVolume[];
  createdAt: number;
  updatedAt: number;
}

export interface PopupRetrievalHints {
  currentVolumeIndexed: boolean;
  missingLocalIndex: boolean;
  missingPriorVolumes: number[];
  missingSeriesAssignment: boolean;
}

export interface PopupContextBundle {
  localPastContext: string;
  localFutureBuffer: string;
  sameBookChunks: string[];
  priorVolumeChunks: string[];
  retrievalStatus: RetrievalStatus;
  retrievalHints: PopupRetrievalHints;
}

export interface ContextTranslationSettings {
  enabled: boolean;
  targetLanguage: string;
  recentContextPages: number;
  lookAheadWords: number;
  sameBookRagEnabled: boolean;
  priorVolumeRagEnabled: boolean;
  sameBookChunkCount: number;
  priorVolumeChunkCount: number;
  outputFields: TranslationOutputField[];
}
```

Update `defaults.ts` to include concrete values:

```ts
lookAheadWords: 80,
sameBookRagEnabled: true,
priorVolumeRagEnabled: true,
sameBookChunkCount: 3,
priorVolumeChunkCount: 2,
```

Update `AIPanel.tsx` to expose two explicit popup toggles:

```tsx
<Toggle
  label='Use same-book memory'
  checked={ctxSameBookRagEnabled}
  onChange={(value) => saveCtxTransSetting({ sameBookRagEnabled: value })}
/>
<Toggle
  label='Use prior-volume memory'
  checked={ctxPriorVolumeRagEnabled}
  onChange={(value) => saveCtxTransSetting({ priorVolumeRagEnabled: value })}
/>
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `corepack pnpm --dir apps/readest-app test -- --watch=false src/__tests__/contextTranslation/defaults.test.ts src/__tests__/components/settings/AIPanel.test.tsx`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add apps/readest-app/src/services/contextTranslation/types.ts apps/readest-app/src/services/contextTranslation/defaults.ts apps/readest-app/src/components/settings/AIPanel.tsx apps/readest-app/src/__tests__/contextTranslation/defaults.test.ts apps/readest-app/src/__tests__/components/settings/AIPanel.test.tsx
git commit -m "feat: extend popup retrieval and series types"
```

### Task 2: Upgrade series persistence from sibling hashes to ordered volumes

**Files:**
- Modify: `apps/readest-app/src/services/ai/storage/aiStore.ts`
- Modify: `apps/readest-app/src/services/contextTranslation/seriesService.ts`
- Test: `apps/readest-app/src/__tests__/contextTranslation/seriesService.test.ts`

- [ ] **Step 1: Write the failing tests**

```ts
test('returns ordered prior volumes for the current book', async () => {
  await saveSeries({
    id: 'series-1',
    name: 'The Grey Castle',
    volumes: [
      { bookHash: 'vol-1', volumeIndex: 1, label: 'Vol. 1' },
      { bookHash: 'vol-2', volumeIndex: 2, label: 'Vol. 2' },
      { bookHash: 'vol-3', volumeIndex: 3, label: 'Vol. 3' },
    ],
    createdAt: 1,
    updatedAt: 1,
  });

  const prior = await getPriorVolumes('vol-3');
  expect(prior.map((volume) => volume.bookHash)).toEqual(['vol-1', 'vol-2']);
});

test('can update a book volume label and ordering', async () => {
  await updateSeriesVolume('series-1', 'vol-2', { volumeIndex: 4, label: 'Book 4' });
  const series = await getSeriesForBook('vol-2');
  expect(series?.volumes.find((volume) => volume.bookHash === 'vol-2')?.label).toBe('Book 4');
});

test('migrates legacy bookHashes series rows to ordered volumes without losing order', async () => {
  await saveLegacySeriesRecord({
    id: 'legacy-series',
    name: 'Legacy Saga',
    bookHashes: ['vol-a', 'vol-b', 'vol-c'],
    createdAt: 1,
    updatedAt: 1,
  });

  const series = await getSeriesForBook('vol-b');
  expect(series?.volumes.map((volume) => volume.bookHash)).toEqual(['vol-a', 'vol-b', 'vol-c']);
  expect(series?.volumes.map((volume) => volume.volumeIndex)).toEqual([1, 2, 3]);
});

test('backfills all legacy series rows during migration sweep', async () => {
  await saveLegacySeriesRecord({
    id: 'legacy-1',
    name: 'Legacy One',
    bookHashes: ['a', 'b'],
    createdAt: 1,
    updatedAt: 1,
  });
  await saveLegacySeriesRecord({
    id: 'legacy-2',
    name: 'Legacy Two',
    bookHashes: ['c'],
    createdAt: 1,
    updatedAt: 1,
  });

  await migrateLegacySeriesRecords();

  const all = await getAllSeries();
  expect(all.every((series) => 'volumes' in series)).toBe(true);
  expect(all.find((series) => series.id === 'legacy-1')?.volumes[1]?.volumeIndex).toBe(2);
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `corepack pnpm --dir apps/readest-app test -- --watch=false src/__tests__/contextTranslation/seriesService.test.ts`
Expected: FAIL because the current persistence model only stores `bookHashes: string[]`.

- [ ] **Step 3: Write the minimal implementation**

In `aiStore.ts`, keep the same object store but persist the richer `BookSeries` object shape and normalize reads:

```ts
function normalizeSeriesRecord(raw: BookSeries | LegacyBookSeries): BookSeries {
  if ('volumes' in raw) {
    return {
      ...raw,
      volumes: [...raw.volumes].sort((a, b) => a.volumeIndex - b.volumeIndex),
    };
  }

  return {
    id: raw.id,
    name: raw.name,
    volumes: raw.bookHashes.map((bookHash, index) => ({
      bookHash,
      volumeIndex: index + 1,
      label: `Vol. ${index + 1}`,
    })),
    createdAt: raw.createdAt,
    updatedAt: raw.updatedAt,
  };
}

async saveSeries(series: BookSeries): Promise<void> {
  const normalized = normalizeSeriesRecord(series);
  // persist normalized
}
```

Add an explicit eager migration helper in `aiStore.ts`:

```ts
async migrateLegacySeriesRecords(): Promise<void> {
  const allRows = await loadRawSeriesRows();
  const legacyRows = allRows.filter((row) => !('volumes' in row));

  for (const row of legacyRows) {
    await saveSeries(normalizeSeriesRecord(row));
  }
}
```

Call that helper eagerly from `getAllSeries()` before any series rows are returned, and make `getSeriesForBook()` delegate through `getAllSeries()` so untouched legacy rows are rewritten before the new `My Series` and retrieval flows consume them.

In `seriesService.ts`, add ordered APIs:

```ts
export async function getPriorVolumes(currentBookHash: string): Promise<BookSeriesVolume[]> { ... }
export async function updateSeriesVolume(
  seriesId: string,
  bookHash: string,
  updates: Partial<Pick<BookSeriesVolume, 'volumeIndex' | 'label'>>,
): Promise<void> { ... }
export async function getSeriesIndexStatus(seriesId: string): Promise<SeriesIndexStatus> { ... }
```

Keep compatibility shims only long enough to update existing callers in later chunks.

- [ ] **Step 4: Run tests to verify they pass**

Run: `corepack pnpm --dir apps/readest-app test -- --watch=false src/__tests__/contextTranslation/seriesService.test.ts`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add apps/readest-app/src/services/ai/storage/aiStore.ts apps/readest-app/src/services/contextTranslation/seriesService.ts apps/readest-app/src/__tests__/contextTranslation/seriesService.test.ts
git commit -m "feat: support ordered series volumes"
```

## Chunk 2: Bounded Local Context And Hybrid Retrieval

### Task 3: Build selection-bounded local past context and future buffer

**Files:**
- Modify: `apps/readest-app/src/services/contextTranslation/pageContextService.ts`
- Modify: `apps/readest-app/src/services/contextTranslation/contextAssembler.ts`
- Test: `apps/readest-app/src/__tests__/contextTranslation/pageContextService.test.ts`
- Test: `apps/readest-app/src/__tests__/contextTranslation/contextAssembler.test.ts`

- [ ] **Step 1: Write the failing tests**

```ts
test('truncates local past context at the selected text on the current page', async () => {
  const bundle = await buildLocalContext({
    bookHash: 'book-1',
    currentPage: 10,
    selectedText: '身侧',
    recentContextPages: 3,
    lookAheadWords: 80,
  });

  expect(bundle.localPastContext).toContain('走在四王子');
  expect(bundle.localPastContext).not.toContain('身侧。后文继续');
});

test('builds a future buffer starting immediately after the selected text', async () => {
  const bundle = await buildLocalContext({
    bookHash: 'book-1',
    currentPage: 10,
    selectedText: '身侧',
    recentContextPages: 3,
    lookAheadWords: 8,
  });

  expect(bundle.localFutureBuffer.startsWith('。')).toBe(true);
  expect(bundle.localFutureBuffer.split(/\s+/).length).toBeLessThanOrEqual(8);
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `corepack pnpm --dir apps/readest-app test -- --watch=false src/__tests__/contextTranslation/pageContextService.test.ts src/__tests__/contextTranslation/contextAssembler.test.ts`
Expected: FAIL because local context is currently a flat page window without selection boundaries.

- [ ] **Step 3: Write the minimal implementation**

Refactor `pageContextService.ts` to expose page-window material rather than only a flattened string:

```ts
export interface PageWindowChunk {
  pageNumber: number;
  text: string;
}

export async function getRecentPageWindow(
  bookHash: string,
  currentPage: number,
  windowSize: number,
): Promise<PageWindowChunk[]> { ... }
```

Then in `contextAssembler.ts`, add a dedicated builder:

```ts
export function buildBoundedLocalContext(
  pageWindow: PageWindowChunk[],
  selectedText: string,
  lookAheadWords: number,
): Pick<PopupContextBundle, 'localPastContext' | 'localFutureBuffer'> { ... }
```

Use first-match truncation on the current page. If the selected text is not found, fall back to the old full-page-window behavior.

- [ ] **Step 4: Run tests to verify they pass**

Run: `corepack pnpm --dir apps/readest-app test -- --watch=false src/__tests__/contextTranslation/pageContextService.test.ts src/__tests__/contextTranslation/contextAssembler.test.ts`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add apps/readest-app/src/services/contextTranslation/pageContextService.ts apps/readest-app/src/services/contextTranslation/contextAssembler.ts apps/readest-app/src/__tests__/contextTranslation/pageContextService.test.ts apps/readest-app/src/__tests__/contextTranslation/contextAssembler.test.ts
git commit -m "feat: add bounded popup local context assembly"
```

### Task 4: Add bounded same-book and prior-volume hybrid retrieval

**Files:**
- Modify: `apps/readest-app/src/services/ai/ragService.ts`
- Modify: `apps/readest-app/src/services/ai/storage/aiStore.ts`
- Create: `apps/readest-app/src/services/contextTranslation/popupRetrievalService.ts`
- Test: `apps/readest-app/src/__tests__/ai/ragService.test.ts`
- Test: `apps/readest-app/src/__tests__/contextTranslation/popupRetrievalService.test.ts`

- [ ] **Step 1: Write the failing tests**

```ts
test('same-book popup retrieval excludes the local window and later pages', async () => {
  const results = await hybridSearchWithBounds('book-1', '身侧', settings, {
    topK: 3,
    maxPageExclusive: 8,
  });

  expect(results.every((chunk) => chunk.pageNumber < 8)).toBe(true);
});

test('prior-volume popup retrieval only searches earlier volumes', async () => {
  const bundle = await buildPopupRetrievalBundle({
    currentBookHash: 'vol-3',
    selectedText: '殿下',
    queryText: '殿下 请下令',
    localWindowStartPage: 12,
    settings,
  });

  expect(bundle.priorVolumeChunks.every((chunk) => chunk.volumeIndex < 3)).toBe(true);
});

test('reports local-only when the current volume is not indexed', async () => {
  const bundle = await buildPopupRetrievalBundle(...);
  expect(bundle.retrievalStatus).toBe('local-only');
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `corepack pnpm --dir apps/readest-app test -- --watch=false src/__tests__/ai/ragService.test.ts src/__tests__/contextTranslation/popupRetrievalService.test.ts`
Expected: FAIL because popup retrieval does not yet have bounded hybrid retrieval or status computation.

- [ ] **Step 3: Write the minimal implementation**

In `ragService.ts`, add a bounded variant without breaking chat:

```ts
export async function hybridSearchWithBounds(
  bookHash: string,
  query: string,
  settings: AISettings,
  options: {
    topK: number;
    maxPageExclusive?: number;
  },
): Promise<ScoredChunk[]> { ... }
```

In `aiStore.ts`, reuse the existing `maxPage` filtering by translating `maxPageExclusive` to `maxPageExclusive - 1`.

Create `popupRetrievalService.ts` to orchestrate:

```ts
export async function buildPopupRetrievalBundle(args: {
  currentBookHash: string;
  selectedText: string;
  queryText: string;
  localWindowStartPage: number;
  settings: AISettings;
  popupSettings: ContextTranslationSettings;
}): Promise<PopupContextBundle> { ... }
```

Rules:
- if current volume is not indexed, do not use same-book or prior-volume retrieval
- same-book retrieval only searches `pageNumber < localWindowStartPage`
- prior-volume retrieval searches all indexed prior volumes, merges candidates globally, and reranks
- compute `retrievalStatus` and `retrievalHints` from actual availability

- [ ] **Step 4: Run tests to verify they pass**

Run: `corepack pnpm --dir apps/readest-app test -- --watch=false src/__tests__/ai/ragService.test.ts src/__tests__/contextTranslation/popupRetrievalService.test.ts`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add apps/readest-app/src/services/ai/ragService.ts apps/readest-app/src/services/ai/storage/aiStore.ts apps/readest-app/src/services/contextTranslation/popupRetrievalService.ts apps/readest-app/src/__tests__/ai/ragService.test.ts apps/readest-app/src/__tests__/contextTranslation/popupRetrievalService.test.ts
git commit -m "feat: add bounded hybrid popup retrieval"
```

## Chunk 3: Popup And Chat Integration

### Task 5: Thread the structured context bundle through the popup translation path

**Files:**
- Modify: `apps/readest-app/src/services/contextTranslation/promptBuilder.ts`
- Modify: `apps/readest-app/src/hooks/useContextTranslation.ts`
- Modify: `apps/readest-app/src/services/contextTranslation/translationService.ts`
- Test: `apps/readest-app/src/__tests__/contextTranslation/promptBuilder.test.ts`
- Test: `apps/readest-app/src/__tests__/contextTranslation/useContextTranslation.test.ts`
- Test: `apps/readest-app/src/__tests__/contextTranslation/translationService.test.ts`

- [ ] **Step 1: Write the failing tests**

```ts
test('renders labeled popup context sections in the prompt', () => {
  const { userPrompt } = buildTranslationPrompt({
    ...baseRequest,
    popupContext: {
      localPastContext: 'past',
      localFutureBuffer: 'future',
      sameBookChunks: ['same-book memory'],
      priorVolumeChunks: ['prior-volume memory'],
      retrievalStatus: 'cross-volume',
      retrievalHints: { ... },
    },
  });

  expect(userPrompt).toContain('<local_past_context>');
  expect(userPrompt).toContain('<local_future_buffer>');
  expect(userPrompt).toContain('<same_book_memory>');
  expect(userPrompt).toContain('<prior_volume_memory>');
});

test('publishes popup retrieval status through the hook', async () => {
  const { result } = renderHook(() => useContextTranslation(defaultProps));
  await waitFor(() => expect(result.current.retrievalStatus).toBe('local-volume'));
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `corepack pnpm --dir apps/readest-app test -- --watch=false src/__tests__/contextTranslation/promptBuilder.test.ts src/__tests__/contextTranslation/useContextTranslation.test.ts src/__tests__/contextTranslation/translationService.test.ts`
Expected: FAIL because the prompt and hook still use one flat `ragContext` string and do not expose retrieval status.

- [ ] **Step 3: Write the minimal implementation**

Update `TranslationRequest` to accept a structured popup bundle:

```ts
export interface TranslationRequest {
  selectedText: string;
  popupContext?: PopupContextBundle;
  translationResultSummary?: string;
  sourceLanguage?: string;
  targetLanguage: string;
  outputFields: TranslationOutputField[];
}
```

In `promptBuilder.ts`, write labeled sections into `userPrompt`:

```ts
const popupContextSection = request.popupContext
  ? `
<local_past_context>${request.popupContext.localPastContext}</local_past_context>
<local_future_buffer>${request.popupContext.localFutureBuffer}</local_future_buffer>
<same_book_memory>${request.popupContext.sameBookChunks.join('\n\n')}</same_book_memory>
<prior_volume_memory>${request.popupContext.priorVolumeChunks.join('\n\n')}</prior_volume_memory>
`
  : '';
```

In `useContextTranslation.ts`, load:
- bounded local context
- popup retrieval bundle
- then stream translation

Drop the old flat `recentContext` field from the popup translation path and derive prompt context exclusively from `popupContext`. Do not keep `recentContext` as a parallel alias in the popup flow.

Expose:

```ts
retrievalStatus: RetrievalStatus | null;
retrievalHints: PopupRetrievalHints | null;
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `corepack pnpm --dir apps/readest-app test -- --watch=false src/__tests__/contextTranslation/promptBuilder.test.ts src/__tests__/contextTranslation/useContextTranslation.test.ts src/__tests__/contextTranslation/translationService.test.ts`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add apps/readest-app/src/services/contextTranslation/promptBuilder.ts apps/readest-app/src/hooks/useContextTranslation.ts apps/readest-app/src/services/contextTranslation/translationService.ts apps/readest-app/src/__tests__/contextTranslation/promptBuilder.test.ts apps/readest-app/src/__tests__/contextTranslation/useContextTranslation.test.ts apps/readest-app/src/__tests__/contextTranslation/translationService.test.ts
git commit -m "feat: thread bounded popup retrieval context through translation"
```

### Task 6: Add popup retrieval status UX and Ask About This handoff

**Files:**
- Modify: `apps/readest-app/src/app/reader/components/annotator/ContextTranslationPopup.tsx`
- Modify: `apps/readest-app/src/app/reader/hooks/useOpenAIInNotebook.ts`
- Modify: `apps/readest-app/src/store/aiChatStore.ts`
- Modify: `apps/readest-app/src/services/ai/adapters/TauriChatAdapter.ts`
- Modify: `apps/readest-app/src/services/ai/prompts.ts`
- Test: `apps/readest-app/src/__tests__/components/ContextTranslationPopup.test.tsx`
- Test: `apps/readest-app/src/__tests__/ai/TauriChatAdapter.test.ts`

- [ ] **Step 1: Write the failing tests**

```ts
test('shows a red local-only retrieval status with info text', () => {
  mockUseContextTranslation.mockReturnValue({
    ...baseState,
    retrievalStatus: 'local-only',
    retrievalHints: {
      currentVolumeIndexed: false,
      missingLocalIndex: true,
      missingPriorVolumes: [1, 2],
      missingSeriesAssignment: false,
    },
  });

  render(<ContextTranslationPopup {...defaultProps} />);
  expect(screen.getByText('Local context only')).toBeTruthy();
});

test('shows local-volume-only and cross-volume status states', () => {
  mockUseContextTranslation
    .mockReturnValueOnce({
      ...baseState,
      retrievalStatus: 'local-volume',
      retrievalHints: {
        currentVolumeIndexed: true,
        missingLocalIndex: false,
        missingPriorVolumes: [1, 2],
        missingSeriesAssignment: false,
      },
    })
    .mockReturnValueOnce({
      ...baseState,
      retrievalStatus: 'cross-volume',
      retrievalHints: {
        currentVolumeIndexed: true,
        missingLocalIndex: false,
        missingPriorVolumes: [],
        missingSeriesAssignment: false,
      },
    });

  const { rerender } = render(<ContextTranslationPopup {...defaultProps} />);
  expect(screen.getByText('Local volume context only')).toBeTruthy();

  rerender(<ContextTranslationPopup {...defaultProps} />);
  expect(screen.getByText('Cross-volume context')).toBeTruthy();
});

test('shows info guidance for missing indexing work', () => {
  mockUseContextTranslation.mockReturnValue({
    ...baseState,
    retrievalStatus: 'local-only',
    retrievalHints: {
      currentVolumeIndexed: false,
      missingLocalIndex: true,
      missingPriorVolumes: [1, 2, 3],
      missingSeriesAssignment: false,
    },
  });

  render(<ContextTranslationPopup {...defaultProps} />);
  expect(screen.getByLabelText('Retrieval info')).toHaveAttribute(
    'title',
    expect.stringContaining('Index this volume'),
  );
  expect(screen.getByLabelText('Retrieval info')).toHaveAttribute(
    'title',
    expect.stringContaining('Index volumes 1–3'),
  );
});

test('opens a seeded notebook conversation from Ask About This', async () => {
  await openAIInNotebook({
    bookHash: 'book-1',
    newConversationTitle: 'Ask about 身侧',
    initialUserMessage: [
      'Selected text: 身侧',
      'Popup translation: by his side',
      'Local past context:',
      'past',
      'Local future buffer:',
      'future',
      'Same-book memory:',
      'same-book',
      'Prior-volume memory:',
      'prior-volume',
    ].join('\n'),
  });

  expect(createConversation).toHaveBeenCalled();
  expect(addMessage).toHaveBeenCalledWith(expect.objectContaining({
    content: expect.stringContaining('Popup translation: by his side'),
  }));
  expect(addMessage).toHaveBeenCalledWith(expect.objectContaining({
    content: expect.stringContaining('Prior-volume memory:\nprior-volume'),
  }));
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `corepack pnpm --dir apps/readest-app test -- --watch=false src/__tests__/components/ContextTranslationPopup.test.tsx src/__tests__/ai/TauriChatAdapter.test.ts`
Expected: FAIL because the popup has no retrieval-status chip or chat handoff, and notebook open does not support seeding a first message.

- [ ] **Step 3: Write the minimal implementation**

In `ContextTranslationPopup.tsx`:
- add a compact status row under the header
- map status to color and message
- add an info button with hover text built from `retrievalHints`
- add an `Ask About This` button

Minimal rendering contract:

```tsx
<div className='flex items-center gap-2 text-xs'>
  <span className={statusClassMap[retrievalStatus]}>{statusLabel}</span>
  <InfoTooltip content={hintText} />
</div>
<button onClick={handleAskAboutThis}>Ask About This</button>
```

In `useOpenAIInNotebook.ts`, support:

```ts
openAIInNotebook({
  bookHash,
  newConversationTitle,
  initialUserMessage,
})
```

In `aiChatStore.ts`, add:

```ts
createConversationWithFirstMessage: async (bookHash, title, content) => { ... }
```

In `TauriChatAdapter.ts` and `prompts.ts`, accept the popup seed only as plain message content in the first user message, but keep the normal chat path unchanged. Do not add a metadata-only transport path for the first implementation.

- [ ] **Step 4: Run tests to verify they pass**

Run: `corepack pnpm --dir apps/readest-app test -- --watch=false src/__tests__/components/ContextTranslationPopup.test.tsx src/__tests__/ai/TauriChatAdapter.test.ts`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add apps/readest-app/src/app/reader/components/annotator/ContextTranslationPopup.tsx apps/readest-app/src/app/reader/hooks/useOpenAIInNotebook.ts apps/readest-app/src/store/aiChatStore.ts apps/readest-app/src/services/ai/adapters/TauriChatAdapter.ts apps/readest-app/src/services/ai/prompts.ts apps/readest-app/src/__tests__/components/ContextTranslationPopup.test.tsx apps/readest-app/src/__tests__/ai/TauriChatAdapter.test.ts
git commit -m "feat: add popup retrieval status and ask-about-this handoff"
```

## Chunk 4: My Series Surface And Index All

### Task 7: Add the My Books / My Series library split

**Files:**
- Modify: `apps/readest-app/src/app/library/components/Bookshelf.tsx`
- Modify: `apps/readest-app/src/types/settings.ts`
- Modify: `apps/readest-app/src/app/library/utils/libraryUtils.ts`
- Create: `apps/readest-app/src/app/library/components/SeriesShelf.tsx`
- Create: `apps/readest-app/src/app/library/components/SeriesCard.tsx`
- Test: `apps/readest-app/src/__tests__/app/library/Bookshelf.test.tsx`
- Test: `apps/readest-app/src/__tests__/app/library/SeriesShelf.test.tsx`

- [ ] **Step 1: Write the failing tests**

```tsx
test('switches between My Books and My Series', async () => {
  render(<Bookshelf {...defaultProps} />);

  fireEvent.click(screen.getByRole('button', { name: 'My Series' }));
  expect(screen.getByText('No series yet.')).toBeTruthy();
});

test('does not expose metadata-series grouping once My Series exists', () => {
  expect(LibraryGroupByType.Series).toBeUndefined();
});

test('renders ordered volumes and per-volume indexing state in My Series', async () => {
  render(<SeriesShelf />);

  expect(screen.getByText('The Grey Castle')).toBeTruthy();
  expect(screen.getByText('Vol. 1')).toBeTruthy();
  expect(screen.getByText('Indexed')).toBeTruthy();
  expect(screen.getByText('Not indexed')).toBeTruthy();
  expect(screen.getByRole('button', { name: 'Index All' })).toBeTruthy();
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `corepack pnpm --dir apps/readest-app test -- --watch=false src/__tests__/app/library/Bookshelf.test.tsx src/__tests__/app/library/SeriesShelf.test.tsx`
Expected: FAIL because the library has no bottom switch or dedicated series surface.

- [ ] **Step 3: Write the minimal implementation**

In `Bookshelf.tsx`, add a simple mode switch state or URL param:

```tsx
type LibrarySurfaceMode = 'books' | 'series';
```

Render `SeriesShelf` when the mode is `series`. Keep `My Books` behavior unchanged.

In `SeriesShelf.tsx`, load all series and render `SeriesCard` items with:
- series name
- ordered volumes
- indexed / not indexed badge per volume
- `Index All` button

In `types/settings.ts` and `libraryUtils.ts`, remove the metadata-driven `series` grouping mode so the only series UX is the dedicated `My Series` surface.

- [ ] **Step 4: Run tests to verify they pass**

Run: `corepack pnpm --dir apps/readest-app test -- --watch=false src/__tests__/app/library/Bookshelf.test.tsx src/__tests__/app/library/SeriesShelf.test.tsx`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add apps/readest-app/src/app/library/components/Bookshelf.tsx apps/readest-app/src/app/library/components/SeriesShelf.tsx apps/readest-app/src/app/library/components/SeriesCard.tsx apps/readest-app/src/types/settings.ts apps/readest-app/src/app/library/utils/libraryUtils.ts apps/readest-app/src/__tests__/app/library/Bookshelf.test.tsx apps/readest-app/src/__tests__/app/library/SeriesShelf.test.tsx
git commit -m "feat: add my series library surface"
```

### Task 8: Rework series management, index-all, and import suggestions

**Files:**
- Modify: `apps/readest-app/src/app/library/components/SeriesModal.tsx`
- Modify: `apps/readest-app/src/app/library/page.tsx`
- Modify: `apps/readest-app/src/app/library/components/LibraryHeader.tsx`
- Modify: `apps/readest-app/src/app/library/components/ImportMenu.tsx`
- Modify: `apps/readest-app/src/app/library/components/BookshelfItem.tsx`
- Modify: `apps/readest-app/src/app/reader/components/notebook/AIAssistant.tsx`
- Modify: `apps/readest-app/src/services/contextTranslation/seriesService.ts`
- Test: `apps/readest-app/src/__tests__/app/library/SeriesModal.test.tsx`
- Test: `apps/readest-app/src/__tests__/app/library/ImportSeriesSuggestion.test.tsx`
- Test: `apps/readest-app/src/__tests__/contextTranslation/seriesService.test.ts`

- [ ] **Step 1: Write the failing tests**

```ts
test('indexes all volumes in a series in ascending order', async () => {
  await handleIndexAll('series-1');
  expect(indexBook).toHaveBeenNthCalledWith(1, expect.anything(), 'vol-1', expect.anything(), expect.anything());
  expect(indexBook).toHaveBeenNthCalledWith(2, expect.anything(), 'vol-2', expect.anything(), expect.anything());
});

test('suggests a matching series on import based on title and author', async () => {
  const suggestions = await suggestSeriesMatches({
    title: 'Grey Castle 4',
    author: 'Zhang San',
  });

  expect(suggestions[0]?.name).toBe('Grey Castle');
});

test('shows an import-time confirmation when a newly imported book matches a series', async () => {
  render(<LibraryPage />);

  await importBookFixture({
    title: 'Grey Castle 4',
    author: 'Zhang San',
  });

  expect(screen.getByText('Add to series?')).toBeTruthy();
  expect(screen.getByText('Grey Castle')).toBeTruthy();
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `corepack pnpm --dir apps/readest-app test -- --watch=false src/__tests__/app/library/SeriesModal.test.tsx src/__tests__/contextTranslation/seriesService.test.ts`
Expected: FAIL because `SeriesModal` does not manage ordered volumes or series-wide indexing, and import suggestions do not exist.

- [ ] **Step 3: Write the minimal implementation**

In `SeriesModal.tsx`, replace “pick one loose series” behavior with:
- ordered volume list
- editable labels / positions
- per-volume index status
- `Index All`

In `seriesService.ts`, add:

```ts
export async function indexSeries(
  seriesId: string,
  settings: AISettings,
  loadBookDoc: (bookHash: string) => Promise<BookDocType | null>,
  onProgress?: (progress: SeriesIndexProgress) => void,
): Promise<void> { ... }

export async function suggestSeriesMatches(input: {
  title: string;
  author: string;
}): Promise<BookSeries[]> { ... }
```

Use conservative heuristics for suggestions:
- same normalized author
- strong title prefix overlap
- optional volume-number pattern match

Show suggestions on import, but require confirmation before adding the book to a series.

Wire import suggestions to the real import path:
- `page.tsx` should run `suggestSeriesMatches(...)` after successful import
- `LibraryHeader.tsx` and `ImportMenu.tsx` should remain entry points, but they should pass through the post-import suggestion flow already owned by `page.tsx`
- the confirmation UI should live in the library page flow, not inside `SeriesModal`

- [ ] **Step 4: Run tests to verify they pass**

Run: `corepack pnpm --dir apps/readest-app test -- --watch=false src/__tests__/app/library/SeriesModal.test.tsx src/__tests__/contextTranslation/seriesService.test.ts`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add apps/readest-app/src/app/library/components/SeriesModal.tsx apps/readest-app/src/app/library/page.tsx apps/readest-app/src/app/library/components/LibraryHeader.tsx apps/readest-app/src/app/library/components/ImportMenu.tsx apps/readest-app/src/app/library/components/BookshelfItem.tsx apps/readest-app/src/app/reader/components/notebook/AIAssistant.tsx apps/readest-app/src/services/contextTranslation/seriesService.ts apps/readest-app/src/__tests__/app/library/SeriesModal.test.tsx apps/readest-app/src/__tests__/app/library/ImportSeriesSuggestion.test.tsx apps/readest-app/src/__tests__/contextTranslation/seriesService.test.ts
git commit -m "feat: add ordered series management and index-all flow"
```

## Final Verification

- [ ] **Step 1: Run focused context-translation and RAG tests**

Run:

```bash
corepack pnpm --dir apps/readest-app test -- --watch=false \
  src/__tests__/contextTranslation/defaults.test.ts \
  src/__tests__/contextTranslation/pageContextService.test.ts \
  src/__tests__/contextTranslation/contextAssembler.test.ts \
  src/__tests__/contextTranslation/popupRetrievalService.test.ts \
  src/__tests__/contextTranslation/seriesService.test.ts \
  src/__tests__/contextTranslation/promptBuilder.test.ts \
  src/__tests__/contextTranslation/translationService.test.ts \
  src/__tests__/contextTranslation/useContextTranslation.test.ts \
  src/__tests__/components/settings/AIPanel.test.tsx \
  src/__tests__/components/ContextTranslationPopup.test.tsx \
  src/__tests__/ai/ragService.test.ts \
  src/__tests__/ai/TauriChatAdapter.test.ts
```

Expected: PASS

- [ ] **Step 2: Run focused library tests**

Run:

```bash
corepack pnpm --dir apps/readest-app test -- --watch=false \
  src/__tests__/app/library/Bookshelf.test.tsx \
  src/__tests__/app/library/SeriesShelf.test.tsx \
  src/__tests__/app/library/SeriesModal.test.tsx \
  src/__tests__/app/library/ImportSeriesSuggestion.test.tsx
```

Expected: PASS

- [ ] **Step 3: Run production build**

Run: `corepack pnpm --dir apps/readest-app build`
Expected: PASS, with only the existing export warnings about rewrites/headers.

- [ ] **Step 4: Manual smoke checks**

Verify manually:
- popup status chip changes across indexed / non-indexed scenarios
- local context is truncated at the selected word
- future buffer is appended separately
- same-book RAG excludes the local window
- prior-volume RAG excludes current and future volumes
- `Ask About This` opens notebook AI with seeded context
- `My Series` shows ordered volumes and `Index All`

- [ ] **Step 5: Final commit**

```bash
git add apps/readest-app/src docs/superpowers/specs/2026-03-20-context-translation-rag-series-design.md docs/superpowers/plans/2026-03-20-context-translation-rag-series.md
git commit -m "feat: add bounded popup rag and series management"
```
