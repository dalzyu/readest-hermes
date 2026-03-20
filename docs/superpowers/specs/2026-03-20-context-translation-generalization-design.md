# Context-Aware Translation Generalization Design

## Goal

Generalize the popup context-aware translation flow from its current Chinese/English-biased implementation into:

- an any-to-any translation popup
- a separate dictionary popup for same-language simplified explanations
- a plugin-style language feature system for pronunciation and annotation features

## Problems To Solve

1. The LLM sometimes echoes the original term as the translation.
2. The current prompt and rendering logic are biased toward Chinese and English.
3. Language-specific features are hardcoded instead of extensible.
4. Translation and dictionary behavior are mixed conceptually, but they serve different jobs.

## Product Split

### Translation Popup

Purpose:
- translate a selected term or phrase into a chosen target language
- explain the selection using the surrounding context

Rules:
- all primary output is target-language-first
- examples keep source-language source text and target-language translated text
- language-specific enhancements are optional plugins

### Dictionary Popup

Purpose:
- explain the selected term in the original language using simpler wording
- keep the reader grounded in the source language instead of translating away from it

Rules:
- all primary output remains in the source language
- examples remain source-language only unless a later design explicitly expands them

## Architecture

The system should be split into four layers.

### 1. Mode Definition Layer

Defines the behavior for:

- `translation`
- `dictionary`

Each mode owns:

- prompt contract
- output schema
- validation rules
- popup renderer

This avoids forcing one prompt and one renderer to serve two incompatible jobs.

### 2. Language-Agnostic Core Pipeline

Responsibilities:

- detect source language
- assemble popup context
- build a mode-specific request
- call the LLM
- parse structured output
- normalize and validate the response
- pass normalized data to the UI

This layer must not hardcode language-specific features like pinyin.

### 3. Language Plugin Layer

Plugins are keyed primarily by language, not by language pair.

Responsibilities:

- declare supported features
- enrich normalized output with language-specific metadata
- provide rendering helpers for annotations
- run additional language-specific validation

Examples:

- `zh`: pinyin, Han segmentation support, ruby rendering data
- `en`: syllables, stress hints if available
- `ja`: kana or furigana-style reading metadata
- `ko`: romanization
- fallback plugin: no enrichment, plain rendering

### 4. Popup Renderer Layer

The UI should render normalized structured data instead of parsing labeled freeform text.

The renderer should:

- show a plain baseline view for every language
- ask the relevant plugin whether enhanced rendering is available
- remain functional even when no plugin exists

## Internal Response Models

The LLM may still emit tagged text, JSON, or another transport shape, but the application should normalize all responses into internal typed models before rendering.

### Translation Mode Model

- `term`
- `sourceLanguage`
- `targetLanguage`
- `translation`
- `meaning`
- `usageExamples: Array<{ sourceText: string; targetText: string }>`
- `notes?: string[]`
- `pluginData?: unknown`

Rules:

- `translation` must be in the target language
- `meaning` must be in the target language
- `usageExamples[].sourceText` remains in the source language
- `usageExamples[].targetText` must be in the target language

### Dictionary Mode Model

- `term`
- `sourceLanguage`
- `simpleDefinition`
- `contextualMeaning`
- `sourceExamples: string[]`
- `notes?: string[]`
- `pluginData?: unknown`

Rules:

- all primary fields remain in the source language
- the explanation should simplify, not merely restate, the original term

## Plugin API

The plugin boundary should stay narrow and deterministic.

Suggested interface:

- `supports(mode, language)`
- `enrich(result, context)`
- `renderInlineAnnotation(...)`
- `renderExampleAnnotation(...)`
- `validate(result)`

Guidelines:

- plugins enrich normalized data rather than rewrite raw LLM output
- core validation handles shape and cross-language rules
- plugins add language-specific metadata and rendering support

## Validation And Recovery

Validation must happen between LLM output and UI rendering.

### Translation Validation

- translation must not be empty
- translation must not trivially equal the source text unless unchanged borrowing is expected
- meaning must be present and target-language-first
- examples must preserve source and target language roles correctly

If validation fails:

1. retry once with a stricter repair prompt
2. if repair still fails, degrade gracefully

Graceful degradation:

- keep valid translation and meaning fields
- discard malformed examples
- avoid rendering ambiguous or misleading annotations

### Dictionary Validation

- explanation fields must stay in the source language
- simplified explanation must be present
- source examples must remain source-language only

If validation fails:

- retry once with a simplification-specific repair prompt
- otherwise fall back to a shorter contextual explanation

## Prompt Policy

Prompting should become mode-aware and schema-aware.

### Translation Prompt Policy

- emphasize that all primary fields are target-language-first
- explicitly forbid echoing the original source term as the translation unless unchanged borrowing is intended
- request structured examples as source and target pairs

### Dictionary Prompt Policy

- explicitly request simpler source-language explanations
- forbid switching into the target language
- request source-language examples only

## Rendering Policy

The popup UI should stop parsing ad hoc labels like `English:` and `Chinese:` as a primary mechanism.

Instead:

- translation popup renders typed example pairs
- dictionary popup renders typed source-language explanation fields
- plugins decide whether to add pronunciation or annotation views

Baseline behavior for every language:

- readable plain text
- no plugin requirement
- no broken formatting when plugins are absent

## Rollout Plan

### Phase 1

Introduce normalized internal models and validation for the translation popup without yet redesigning every language enhancement.

### Phase 2

Split translation popup and dictionary popup into separate mode-specific flows and UI components.

### Phase 3

Move current Chinese-specific logic out of the core and into the first language plugin.

### Phase 4

Add additional plugins, starting with English, then other languages based on priority.

## Testing Strategy

### Unit Tests

- prompt builder tests per mode
- normalization tests
- validator tests
- plugin enrichment tests

### Failure Fixtures

Add fixtures for:

- source text echoed as translation
- explanation in the wrong language
- malformed examples
- missing required fields
- unsupported plugin annotations

### UI Tests

- plain fallback rendering
- plugin-enhanced rendering
- dictionary popup rendering
- graceful degradation when examples or annotations are invalid

### Representative Language Matrix

- `en -> zh`
- `zh -> en`
- `ja -> fr`
- `ko -> en`
- source-language dictionary mode

## Recommendation

Implement the schema-driven core plus language plugin architecture rather than extending the current language-specific prompt and renderer assumptions.

This is the smallest design that:

- supports any-to-any translation as a default behavior
- preserves target-language-first output
- allows language-specific feature growth without core coupling
- gives dictionary mode a clean separate product surface
