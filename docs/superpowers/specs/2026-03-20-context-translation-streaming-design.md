# Context Translation Streaming Design

## Goal

Improve the context-aware translation popup so it:

- streams partial results into the existing field cards as the model responds
- reduces perceived latency before content appears
- enforces better Chinese output for usage examples
- keeps field ordering stable and predictable

## Current Problems

- The popup waits for the full LLM response before rendering any field content.
- The hook assembles recent context and RAG context sequentially, adding avoidable delay before the model call starts.
- The prompt does not strongly constrain `examples`, so English-only examples are allowed even when the source text is Chinese.
- The parser only handles complete tagged output after the full response is available.

## Chosen Approach

Use structured streaming with XML-tagged fields.

- The model will stream tagged content in field order.
- The client will incrementally parse partial XML and update field cards in place.
- The popup will keep the current card layout instead of switching to a single raw text area.

This avoids a second model call, preserves the existing UI structure, and gives the user visible progress while the model is still generating.

## Architecture

### 1. Streaming translation service

Replace the single-shot context translation call with a streaming variant built on `streamText`.

- Add a new streaming API in `src/services/contextTranslation/translationService.ts`.
- Keep the existing non-streaming API only if tests or callers still need it.
- The streaming API will yield a structured state object containing:
  - `fields`: partial text per field id
  - `activeFieldId`: the field currently being filled
  - `done`: whether generation completed
  - `rawText`: the accumulated model output for fallback/debugging

### 2. Incremental field parser

Add a small parser dedicated to partial XML-ish tagged output.

- Input: accumulated streamed text plus enabled field definitions
- Output:
  - current field values for fully or partially seen tags
  - active field id
  - completion state per field
- Behavior:
  - preserve configured field order
  - tolerate incomplete closing tags while streaming
  - ignore unknown tags
  - fall back to assigning raw text to `translation` if the output is malformed

### 3. Hook changes

Update `src/hooks/useContextTranslation.ts` to:

- fetch recent page context and cross-volume RAG in parallel with `Promise.all`
- start streaming once context is ready
- publish partial field updates into React state during generation
- expose:
  - `result`
  - `partialResult`
  - `loading`
  - `streaming`
  - `activeFieldId`
  - `error`
  - `saveToVocabulary`

The hook should only allow saving to vocabulary once the stream is complete and a stable final result exists.

### 4. Popup behavior

Update `src/app/reader/components/annotator/ContextTranslationPopup.tsx` to:

- render the configured fields in stable order immediately
- show empty cards or placeholders for not-yet-started fields
- stream text into each card as its tag content arrives
- visually indicate the active field with a typing state
- keep the save button disabled until completion

The popup should never reorder cards based on generation timing.

## Prompt Contract

Strengthen `src/services/contextTranslation/promptBuilder.ts`.

### Global requirements

- Respond using only the requested XML tags.
- Emit fields in the exact configured order.
- Do not write content outside the tags.
- Start with `<translation>`, then `<contextualMeaning>`, then `<examples>` when enabled.

### Chinese-specific example format

When the selected text is Chinese or the source language is Chinese:

- `examples` must contain numbered entries
- each entry must include:
  - a Chinese sentence
  - a `Pinyin:` line
  - an `English:` line

Required layout:

`1. 中文句子`
`Pinyin: ...`
`English: ...`

`2. 中文句子`
`Pinyin: ...`
`English: ...`

This makes English-only examples explicitly invalid.

## Error Handling

- If context gathering fails, surface the error as today.
- If streaming fails mid-response, keep already generated field text on screen and mark the popup with an error state.
- If parsing fails, place raw accumulated output into the `translation` field instead of showing a blank popup.
- If the request is cancelled, stop streaming cleanly and avoid stale state writes.

## Testing

### Unit tests

- prompt builder emits ordered field instructions
- prompt builder includes the Chinese example format contract
- incremental parser handles:
  - partial opening tag content
  - completed fields
  - multiple streamed chunks
  - malformed output fallback
- translation service streams partial fields in order
- hook updates partial state during streaming

### UI tests

- popup shows cards in configured order before completion
- active field types in place while later fields remain pending
- save button stays disabled during streaming and enables on completion

## Files Expected To Change

- `apps/readest-app/src/services/contextTranslation/promptBuilder.ts`
- `apps/readest-app/src/services/contextTranslation/responseParser.ts`
- `apps/readest-app/src/services/contextTranslation/translationService.ts`
- `apps/readest-app/src/services/contextTranslation/llmClient.ts`
- `apps/readest-app/src/hooks/useContextTranslation.ts`
- `apps/readest-app/src/app/reader/components/annotator/ContextTranslationPopup.tsx`
- `apps/readest-app/src/__tests__/contextTranslation/promptBuilder.test.ts`
- `apps/readest-app/src/__tests__/contextTranslation/responseParser.test.ts`
- `apps/readest-app/src/__tests__/contextTranslation/translationService.test.ts`
- `apps/readest-app/src/__tests__/contextTranslation/useContextTranslation.test.ts`

## Non-Goals

- changing the popup into a single raw streaming text area
- introducing a separate fast first-pass model call
- redesigning the field configuration model
- changing vocabulary export format beyond storing the final completed result
