# Context Translation RAG And Series Design

## Goal

Upgrade the context-aware translation popup so it:

- uses bounded local context with an explicit future look-ahead buffer
- uses same-book hybrid RAG only from earlier pages
- uses cross-volume hybrid RAG only from earlier volumes in an ordered series
- exposes retrieval quality clearly in the popup UI
- reuses the existing notebook AI chat as the follow-up surface via `Ask About This`
- separates `Series` from generic library grouping, with a dedicated `My Series` surface

## Current State

### Popup translation

The popup currently assembles:

- recent page context via `getRecentPageContext(...)`
- cross-volume context via `getCrossVolumeContext(...)`

The cross-volume lookup is BM25-only and searches sibling books sequentially. The popup does not currently use same-book hybrid RAG.

### AI chat

The notebook AI assistant already uses same-book hybrid retrieval through `hybridSearch(...)` in `ragService.ts`, then injects retrieved chunks into the chat system prompt.

### Series management

Series currently exist as a separate data model under context translation services, but the library UX still treats book grouping and series management as largely separate concepts.

## Chosen Approach

Use layered hybrid retrieval with strict boundaries.

The popup context will be built from three ordered sources:

1. `local_past_context`
2. `local_future_buffer`
3. `retrieved_memory`

`retrieved_memory` is split into:

- `same_book_before_window`
- `prior_volumes_only`

This keeps spoiler behavior explicit, gives the popup better recall than BM25-only retrieval, and preserves the existing hybrid retrieval investment already used by chat.

## Retrieval Design

### 1. Local context

The popup should build local context from the configured recent-page window, but with stricter boundaries than today.

#### Local past context

- Start from the configured `recentContextPages` window.
- Include only pages up to the current page.
- On the current page, truncate text at the selected word.
- This means the local past context ends exactly at the user selection.

#### Local future buffer

- Append a separately labeled future buffer after the local past context.
- The future buffer begins immediately after the selected word on the current page.
- If the current page does not contain enough text, it can continue onto later pages.
- The future buffer is capped by a word budget, for example `80` words.

This produces a prompt structure like:

- `<local_past_context>`
- `<local_future_buffer>`

The local future buffer is intentionally explicit so the model can distinguish “past narrative context” from “near-future continuation.”

### 2. Same-book hybrid RAG

Same-book RAG should search only content that came before the local context window.

#### Eligibility rule

If the local context window starts at page `N`, same-book RAG may only search chunks where:

- `chunk.pageNumber < N`

This ensures same-book retrieval cannot pull content from:

- the current page after the selected word
- the local future buffer
- pages later than the current context window

#### Retrieval method

Use hybrid retrieval:

- BM25 for exact names, honorifics, repeated phrases, and short lexical queries
- embeddings for paraphrases and semantically related earlier scenes

The query should be richer than the selected token alone. Build it from:

- selected text
- containing sentence
- optionally one nearby sentence

Then:

- run BM25 top N
- run vector top N
- normalize and merge
- rerank within the same-book candidate set

### 3. Cross-volume hybrid RAG

Cross-volume retrieval should only search earlier volumes in the same ordered series.

#### Eligibility rule

If the current book is volume `k`, cross-volume RAG may only search volumes where:

- `volumeIndex < k`

No current-volume or future-volume chunks are eligible.

#### Indexing rule

If the current volume is not indexed, the popup should not use prior-volume retrieval even if earlier volumes are indexed. In that case, the popup should report `Local context only`.

This keeps the user-visible retrieval status simple and prevents a confusing state where “cross-volume” appears available without local-volume grounding.

#### Retrieval method

Use the same hybrid approach as same-book retrieval:

- BM25 top N
- vector top N
- merge and rerank

Unlike the current implementation, retrieval should not stop after sequentially checking earlier volumes one by one. Instead:

- gather candidates from all eligible prior volumes
- merge them into one prior-volume candidate pool
- rerank globally

## Context Assembly

Add a popup-specific context assembler that produces a structured retrieval bundle instead of a single flat string.

Expected sections:

- `localPastContext`
- `localFutureBuffer`
- `sameBookChunks`
- `priorVolumeChunks`
- `retrievalStatus`
- `retrievalHints`

The translation prompt should consume these sections with explicit labels rather than one undifferentiated context block.

## Popup Retrieval Status UX

The popup should show retrieval quality explicitly with a status label and info icon.

### Statuses

1. `Local context only`
   - Red text
   - Means no eligible indexed RAG source was used

2. `Local volume context only`
   - Yellow text
   - Means same-book earlier-page RAG was used, but prior-volume RAG was not

3. `Cross-volume context`
   - Green text
   - Means prior-volume RAG was also used

### Info hover content

Hovering the info icon should explain what the user can do next, for example:

- `Index this volume to enable earlier-volume retrieval.`
- `Index volumes 1–3 to enable cross-volume context.`
- `Label this book in a series to enable prior-volume context.`

The status should be computed from actual retrieval eligibility and indexing availability, not just whether the user enabled a setting.

## Ask About This

The popup should gain an `Ask About This` button.

### Behavior

- Reuse the existing notebook AI assistant surface.
- Do not build a separate mini-chat inside the popup.
- Open the notebook on the AI tab.
- Start a new conversation seeded for the current selection.

### Seeded context

The first user message should include:

- selected text
- current popup translation result
- local past context
- local future buffer
- same-book retrieved memory
- prior-volume retrieved memory

The goal is to let the user ask follow-up questions without losing the popup’s bounded retrieval framing.

### Chat integration

The existing chat already has same-book hybrid RAG. Extend its retrieval/context assembly so a seeded popup conversation can:

- carry forward the popup’s bounded context sections
- optionally reuse the popup retrieval bundle
- stay compatible with the normal chat path for ad hoc questions

This should be an extension of the current chat retriever, not a separate chat stack.

## Series Product Model

Keep `Series` separate from generic book grouping.

### Why

- a book may belong to a narrative series and unrelated custom groups
- series require ordered volume labels, indexing state, and cross-volume retrieval semantics
- generic groups should remain lightweight and non-ordered

### Library navigation

Add a bottom bar switch between:

- `My Books`
- `My Series`

#### My Books

- existing library experience
- existing generic grouping stays intact

#### My Series

- dedicated ordered series collections
- volume order editing
- per-volume indexing visibility
- cross-volume readiness management

## Series Features

### 1. Ordered volumes

Each series must have explicit ordered membership.

A series record should support:

- series id
- name
- ordered books
- each book’s volume index
- optional display label such as `Vol. 3`

### 2. Suggested matches on import

When a user imports a new book, Readest may suggest likely series matches based on metadata such as:

- normalized title
- author
- existing series names
- volume-number patterns in the title

Suggestions should always require confirmation.

### 3. Index All

In series management, add an `Index All` action that indexes every book in that series in volume order.

This is important because cross-volume popup retrieval quality depends on prior volumes being indexed.

### 4. Retrieval-aware management

Series management should clearly show:

- which volumes are indexed
- which are missing
- whether the current book has enough indexed predecessors for cross-volume retrieval

## Prompt Contract Changes

The translation prompt should move away from one generic context blob and instead use labeled sections such as:

- `<local_past_context>`
- `<local_future_buffer>`
- `<same_book_memory>`
- `<prior_volume_memory>`

The prompt should instruct the model that:

- local past context is strongest evidence
- local future buffer is near-future continuation, not distant context
- same-book memory comes from earlier pages only
- prior-volume memory comes only from earlier volumes

This lets the model reason over different memory types without conflating them.

## Data Model Changes

### Context translation settings

Add popup retrieval settings for:

- recent local context page count
- local future buffer word count
- same-book RAG enabled
- prior-volume RAG enabled
- same-book chunk count
- prior-volume chunk count

### Series model

Replace the current lightweight `bookHashes: string[]` model with an ordered volume model that can express:

- book hash
- volume index
- optional volume label

## Testing

### Unit tests

- local past context truncates at the selected word
- local future buffer starts after the selected word and respects the word budget
- same-book retrieval excludes local window and later pages
- prior-volume retrieval excludes current and future volumes
- retrieval status resolves correctly for:
  - local-only
  - local-volume-only
  - cross-volume
- popup info text matches the missing indexing state
- import-time series suggestion logic is deterministic for obvious metadata cases

### Integration tests

- popup translation uses same-book hybrid RAG only from earlier pages
- popup translation uses prior-volume hybrid RAG only from earlier volumes
- non-indexed current volume suppresses cross-volume status even if older volumes are indexed
- `Ask About This` opens notebook AI with seeded context
- `Index All` processes a series in volume order

### UI tests

- popup shows correct retrieval status color and info text
- popup opens seeded follow-up chat from `Ask About This`
- library bottom bar switches between `My Books` and `My Series`
- series management shows ordered volumes and indexing state

## Files Expected To Change

- `apps/readest-app/src/hooks/useContextTranslation.ts`
- `apps/readest-app/src/services/contextTranslation/types.ts`
- `apps/readest-app/src/services/contextTranslation/defaults.ts`
- `apps/readest-app/src/services/contextTranslation/promptBuilder.ts`
- `apps/readest-app/src/services/contextTranslation/translationService.ts`
- `apps/readest-app/src/services/contextTranslation/seriesService.ts`
- `apps/readest-app/src/services/contextTranslation/contextAssembler.ts`
- `apps/readest-app/src/services/contextTranslation/pageContextService.ts`
- `apps/readest-app/src/services/ai/ragService.ts`
- `apps/readest-app/src/services/ai/storage/aiStore.ts`
- `apps/readest-app/src/services/ai/adapters/TauriChatAdapter.ts`
- `apps/readest-app/src/services/ai/prompts.ts`
- `apps/readest-app/src/app/reader/components/annotator/ContextTranslationPopup.tsx`
- `apps/readest-app/src/app/reader/hooks/useOpenAIInNotebook.ts`
- `apps/readest-app/src/app/library/components/Bookshelf.tsx`
- `apps/readest-app/src/app/library/components/SeriesModal.tsx`
- `apps/readest-app/src/app/library/components/BookshelfItem.tsx`
- supporting tests under `src/__tests__/contextTranslation`, `src/__tests__/ai`, and library component tests

## Non-Goals

- replacing the existing notebook AI chat surface
- removing BM25 from retrieval
- introducing cross-volume retrieval from current or future volumes
- turning generic custom groups into ordered series
- auto-assigning imported books to a series without user confirmation
