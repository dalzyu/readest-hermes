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
- field layout contract
- degradation policy

This avoids forcing one prompt and one field contract to serve two incompatible jobs.

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
- run additional language-specific validation
- provide typed annotation data only

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
- consume typed annotation data from plugins
- remain functional even when no plugin exists

Renderer ownership is centralized in this layer. Modes define field layout contracts, but plugins do not render UI directly.

## Language Identification And Locale Policy

Language identifiers should use BCP-47 tags where available.

Examples:

- `en`
- `zh-Hans`
- `zh-Hant`
- `pt-BR`
- `ja`

Plugin resolution should follow a fallback chain:

1. exact locale match
2. base language match
3. fallback plugin

Examples:

- `zh-Hans -> zh -> fallback`
- `pt-BR -> pt -> fallback`

The selected target language should come from the popup setting. The source language should come from the current detector, but normalized into the same BCP-47-style representation before validation or plugin selection.

## Internal Response Models

The LLM may still emit tagged text, JSON, or another transport shape, but the application should normalize all responses into internal typed models before rendering.

### Translation Mode Model

- `term`
- `sourceLanguage`
- `targetLanguage`
- `sourceLanguageConfidence?: number`
- `translation`
- `primaryMeaning`
- `alternativeMeanings?: string[]`
- `usageExamples: Array<{ id: string; sourceText: string; targetText: string; sourceTermRanges?: Array<{ start: number; end: number }>; targetTermRanges?: Array<{ start: number; end: number }> }>`
- `notes?: string[]`
- `annotations?: { source?: TranslationAnnotations; target?: TranslationAnnotations }`

Rules:

- `translation` must be in the target language
- `primaryMeaning` must be in the target language
- `usageExamples[].sourceText` remains in the source language
- `usageExamples[].targetText` must be in the target language

`alternativeMeanings` is optional in v1 but keeps the model forward-compatible for multi-sense outputs.

### Dictionary Mode Model

- `term`
- `sourceLanguage`
- `sourceLanguageConfidence?: number`
- `simpleDefinition`
- `contextualMeaning`
- `sourceExamples: string[]`
- `notes?: string[]`
- `annotations?: { source?: DictionaryAnnotations }`

Rules:

- all primary fields remain in the source language
- the explanation should simplify, not merely restate, the original term

## Annotation Models

Plugins should enrich results using typed annotation payloads rather than arbitrary `unknown` blobs.

Suggested shape:

- `TranslationAnnotations`
  - `pronunciation?: PronunciationAnnotation`
  - `segmentation?: SegmentationAnnotation`
  - `exampleAnnotations?: ExampleAnnotation[]`

- `DictionaryAnnotations`
  - `pronunciation?: PronunciationAnnotation`
  - `segmentation?: SegmentationAnnotation`
  - `exampleAnnotations?: ExampleAnnotation[]`

Suggested low-level data:

- `PronunciationAnnotation`
  - `scheme`
  - `tokens: Array<{ text: string; reading: string; stress?: number | null }>`

- `SegmentationAnnotation`
  - `tokens: Array<{ text: string; start: number; end: number }>`

- `ExampleAnnotation`
  - `exampleId`
  - `sourceText`
  - `targetText`
  - `sourceTokens?: Array<{ text: string; start: number; end: number }>`
  - `targetTokens?: Array<{ text: string; start: number; end: number }>`

## Offset And Indexing Contract

All `start` and `end` offsets in normalized models should use Unicode code point indices relative to the specific field string they annotate.

Rules:

- offsets are zero-based
- `end` is exclusive
- ranges are never relative to the whole popup payload
- example ranges are relative to `usageExamples[n].sourceText` or `usageExamples[n].targetText`
- token offsets follow the same rule

The renderer may convert these code point indices into grapheme-safe display spans if needed, but the data contract should remain code-point-based across plugins and validators.

## Plugin API

The plugin boundary should stay narrow and deterministic.

Suggested interface:

- `supports(mode, language)`
- `enrich(result, context)`
- `validate(result)`
- `fallbackLanguage(languageTag)`

Guidelines:

- plugins enrich normalized data rather than rewrite raw LLM output
- core validation handles shape and cross-language rules
- plugins add language-specific metadata and language-local validation support
- the popup renderer owns all actual UI rendering

## Plugin Selection

Plugin selection should be explicit.

### Translation Mode

Run:

- source-language plugin for source-term annotations
- target-language plugin for translated output annotations

Typical usage:

- source plugin enriches `term`, `sourceText`, and source-side example annotations
- target plugin enriches `translation`, `primaryMeaning`, and target-side example annotations

If both plugins enrich the same logical field, the field keeps separate source-side and target-side annotation slots rather than one merged blob.

### Dictionary Mode

Run:

- source-language plugin only

This keeps dictionary mode source-language-first and avoids accidental target-language enrichment.

## Unknown And Mixed-Language Policy

The detector may return:

- a concrete BCP-47 language tag
- `und` for undetermined language
- a low-confidence result for short or mixed text

Policy:

- if source language is `und`, the system still proceeds with the fallback plugin and soft validation only
- if source language confidence is low, the system should avoid hard language-based validation failures unless structural errors also exist
- mixed-language selections should be treated as valid input, but plugin enrichment should default to the fallback plugin unless one language is dominant enough for confident plugin selection
- dictionary mode should refuse only when the selection is too ambiguous to explain reliably in a single source language; otherwise it should continue with fallback behavior

## Annotation Keying And Ownership

Annotation containers should be keyed by logical slot, not plugin id and not raw language tag.

Use:

- `annotations.source`
- `annotations.target`

This avoids collisions between locale variants and keeps renderer lookup deterministic.

Language tags and plugin ids should instead be stored inside annotation metadata or telemetry events.

## Validation And Recovery

Validation must happen between LLM output and UI rendering.

Validation should use layered checks rather than assuming language detection on short strings is reliable.

Validation tiers:

1. structural validation
2. role validation
3. heuristic language validation
4. plugin-assisted validation

Decision states:

- `accept`
- `accept-with-warning`
- `repair`
- `degrade`

### Translation Validation

- translation must not be empty
- translation must not trivially equal the source text unless unchanged borrowing is expected
- meaning must be present and target-language-first
- examples must preserve source and target language roles correctly

Allow-rules for unchanged translation should include at least:

- proper nouns and named entities
- acronyms and initialisms
- numeric values and codes
- URLs, file names, identifiers, and product names
- explicit borrowing cases accepted by plugin or validator rules

Heuristic language validation should be soft for short strings and same-script language pairs. A suspicious result should produce a warning score, not an immediate hard failure, unless multiple checks agree.

Suggested decision policy:

- `accept`
  - structural validation passes
  - no role violation
  - no strong validator warnings
- `accept-with-warning`
  - structural validation passes
  - role validation passes
  - only soft heuristic warnings are present
- `repair`
  - structural validation fails in a repairable way
  - role validation fails
  - or two or more independent warnings agree that the translation is likely wrong
- `degrade`
  - repair attempt already failed
  - or required fields remain unusable after normalization

Independent warnings should mean checks from different sources, for example:

- heuristic language mismatch
- plugin validator disagreement
- identical-source translation without an allow-rule
- malformed example pairing

Same-script pairs and very short strings should require stronger evidence before escalating from `accept-with-warning` to `repair`.

If validation fails:

1. retry once with a stricter repair prompt
2. if repair still fails, degrade gracefully

Graceful degradation:

- keep valid translation and meaning fields
- discard malformed examples
- avoid rendering ambiguous or misleading annotations
- surface a non-blocking internal validation reason for telemetry
- avoid infinite retry loops by capping retries per request

### Dictionary Validation

- explanation fields must stay in the source language
- simplified explanation must be present
- source examples must remain source-language only

If validation fails:

- retry once with a simplification-specific repair prompt
- otherwise fall back to a shorter contextual explanation

## Transport Contract

The preferred LLM transport should be strict structured output, ideally JSON schema or an equivalent schema-bound response format.

Priority order:

1. structured schema response
2. tagged text fallback normalized into the same internal model

The normalization layer should treat tagged text as a compatibility transport only, not as the primary application contract.

The structured transport should carry a schema version so the application can evolve fields without breaking older fallbacks.

Suggested rule:

- version all structured payloads with a top-level schema version
- keep tagged-text normalization tests for backward compatibility until the tagged path is removed

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

## Context Policy And Guardrails

Because popup context is central to output quality, the core pipeline must own context policy.

It should define:

- max context size
- redaction rules
- privacy mode behavior
- truncation order

Suggested truncation order:

1. local past context
2. local future buffer
3. same-book memory
4. prior-volume memory

Privacy mode should allow the application to send only the minimal local context needed for the selected term.

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
- partial valid results may render even when examples or annotations are discarded

## Rollout Plan

### Phase 1

Introduce normalized internal models, structured transport, and validation for the translation popup without yet redesigning every language enhancement.

### Phase 2

Split translation popup and dictionary popup into separate mode-specific flows and UI components behind a feature flag.

### Phase 3

Move current Chinese-specific logic out of the core and into the first language plugin.

### Phase 4

Add additional plugins, starting with English, then other languages based on priority.

Each phase should be protected by:

- feature flags
- kill switches
- telemetry dashboards

Track at least:

- validator failure rate
- repair retry rate
- degraded-render rate
- average latency
- plugin usage by language
- fallback-plugin usage rate

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
- proper nouns preserved as valid unchanged translations
- acronyms and codes preserved as valid unchanged translations
- mixed-language selections
- very short selections

### UI Tests

- plain fallback rendering
- plugin-enhanced rendering
- dictionary popup rendering
- graceful degradation when examples or annotations are invalid
- locale fallback rendering
- plugin-absent rendering
- privacy-mode reduced context behavior

### Representative Language Matrix

- `en -> zh`
- `zh -> en`
- `ja -> fr`
- `ko -> en`
- source-language dictionary mode

Add edge-case coverage for:

- RTL targets
- punctuation-heavy selections
- locale-specific variants such as `zh-Hans` and `zh-Hant`
- same-script pairs such as `en -> fr`
- multi-paragraph context extraction

## Recommendation

Implement the schema-driven core plus language plugin architecture rather than extending the current language-specific prompt and renderer assumptions.

This is the smallest design that:

- supports any-to-any translation as a default behavior
- preserves target-language-first output
- allows language-specific feature growth without core coupling
- gives dictionary mode a clean separate product surface
