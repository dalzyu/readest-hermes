# Hermes Language Learning Enhancement Plan

## TL;DR
Overhaul the AI translation/lookup pipeline for language learners: generalize the LLM harness to support multiple providers/models with inference controls, optimize latency through parallelization and caching, improve dictionary integration with hybrid display and new import formats, add per-field prompting for weak models, and harden any-to-any translation quality. New items: offline-only dictionary fallback, smart word-boundary expansion, popup lookup history sidebar, cost guardrails for multi-field mode, and a prompt test harness for systematic quality evaluation. Phase 2 adds grammar hints, TTS in popup, vocabulary quiz improvements, and reading comprehension.

## Phase 1: LLM Harness Generalization

### 1.1 Multi-provider architecture
- Refactor `AISettings` to support a **list of named provider configs** instead of flat fields per provider type
- Each config: `{ id, name, providerType, baseUrl, model, apiKey?, embeddingBaseUrl?, embeddingModel?, apiStyle }`
- Provider types based on research of Vercel AI SDK ecosystem:
  - **Tier 1 (must-have):** `'openai'`, `'openai-compatible'`, `'anthropic'`, `'google'`, `'ollama'` — covers 90%+ of users
  - **Tier 2 (popular with power users):** `'deepseek'`, `'mistral'`, `'groq'`
  - **Tier 3 (optional):** `'xai'`, `'cohere'`, `'fireworks'`, `'togetherai'`
  - **Meta-provider:** `'openrouter'` via `@openrouter/ai-sdk-provider` — single API key → 100+ models
- Packages to add: `@ai-sdk/anthropic`, `@ai-sdk/google`, `@ai-sdk/openai-compatible`, `@ai-sdk/deepseek`, `@ai-sdk/mistral`, `@ai-sdk/groq`, `@openrouter/ai-sdk-provider`
- Architecture insight: only `@ai-sdk/openai-compatible` + individual proprietary packages needed. All local servers (LM Studio :1234, vLLM :8000, LocalAI :8080, Jan.ai :1337, llama.cpp, KoboldCpp, text-generation-webui) work via `@ai-sdk/openai-compatible` since they expose `/v1/chat/completions`
- Provider factory reads from config list, instantiates per entry
- Settings UI: list of providers, add/edit/delete, health check per entry. For `'openai-compatible'` type, show a note listing compatible local servers

**Embedding support by provider:**
- Embeddings available: OpenAI (`text-embedding-3-*`), Google (`gemini-embedding-001`), Mistral, OpenAI-compatible (local servers w/ embedding endpoints)
- No embeddings: Anthropic, Groq, DeepSeek, xAI, Cohere, Fireworks, TogetherAI
- When a provider lacks embedding support, user must configure a separate embedding provider (or disable RAG)

**Files:**
- `src/services/ai/types.ts` — new `ProviderConfig[]` type, new `AISettings.providers` field, `AIProviderType` union
- `src/services/ai/providers/index.ts` — factory from config list
- `src/services/ai/providers/AnthropicProvider.ts` — new file
- `src/services/ai/providers/GoogleProvider.ts` — new file
- `src/services/ai/providers/OpenRouterProvider.ts` — new file (thin wrapper around `@openrouter/ai-sdk-provider`)
- `src/components/settings/AIPanel.tsx` — dynamic provider list UI

### 1.2 Model-per-task routing
- Add `AISettings.modelAssignments: { translation?: providerId, dictionary?: providerId, chat?: providerId, embedding?: providerId }`
- Default: all tasks use the same provider
- User can assign e.g. fast small model for translation, large model for chat/recap
- `getAIProvider()` becomes `getProviderForTask(task: 'translation' | 'dictionary' | 'chat' | 'embedding')`

**Files:**
- `src/services/ai/types.ts` — `ModelAssignments` type
- `src/services/ai/providers/index.ts` — task-based resolution
- `src/hooks/useContextLookup.ts` — pass task type through
- `src/components/settings/AIPanel.tsx` — model assignment dropdowns

### 1.3 Inference parameter controls
- Add to provider config: `temperature`, `maxTokens`, `topP`, `frequencyPenalty`
- Pass through `llmClient.ts` → `generateText()` / `streamText()` calls
- Sensible defaults: translation (temp 0.3, maxTokens 1024), chat (temp 0.7, maxTokens 2048)
- Advanced settings toggle in UI

**Files:**
- `src/services/ai/types.ts` — inference params in config
- `src/services/contextTranslation/llmClient.ts` — pass params to ai SDK
- `src/components/settings/AIPanel.tsx` — advanced controls section

### 1.4 Provider-specific adapters
- **Anthropic**: `createAnthropic()` from `@ai-sdk/anthropic`. No embeddings — must pair with separate embedding provider.
- **Google**: `createGoogleGenerativeAI()` from `@ai-sdk/google`. Has embeddings via `gemini-embedding-001`.
- **OpenRouter**: `createOpenRouter()` from `@openrouter/ai-sdk-provider`. Single API key → access OpenAI/Anthropic/Llama/Mistral/etc. No embeddings.
- **DeepSeek/Mistral/Groq**: Each has a dedicated `@ai-sdk/*` package with `create*()` factory. All support streaming. No embeddings except Mistral.
- **OpenAI-Compatible**: `createOpenAICompatible()` from `@ai-sdk/openai-compatible`. Catch-all for any local server (LM Studio, vLLM, LocalAI, Jan.ai, llama.cpp, KoboldCpp, oobabooga). Has `transformRequestBody` option for quirky APIs.

## Phase 1: Latency Optimizations

### 1.5 Parallelize RAG searches
- In `buildPopupContextBundle()`: launch sameBook + ALL priorVolume `hybridSearch()` calls via `Promise.all()`
- Current: prior volumes searched serially (200-400ms × N)
- After: all concurrent (200-400ms total regardless of N)

**Files:**
- `src/services/contextTranslation/popupRetrievalService.ts` — `buildPopupContextBundle`

### 1.6 Parallelize dictionary + RAG
- In `contextLookupService.ts`: `lookupDefinitions()` runs before prompt building
- Move it to start concurrently with `buildPopupContextBundle()` at the hook level
- Both resolve via `Promise.all()`, then merged into context

**Files:**
- `src/hooks/useContextLookup.ts` — parallel spawn
- `src/services/contextTranslation/contextLookupService.ts` — accept pre-resolved dict entries

### 1.7 Embedding query cache
- Cache `embed(query)` results by query hash in memory (LRU, ~500 entries)
- Same selected text on same page = instant embedding lookup
- Invalidate on provider/model change

**Files:**
- `src/services/ai/ragService.ts` — add LRU cache around `embed()` call

### 1.8 Page-level RAG chunk cache
- Cache `boundedHybridSearch()` results by `(bookHash, page, queryPrefix)`
- Subsequent lookups on same page reuse RAG context
- TTL: until page navigation

**Files:**
- `src/services/contextTranslation/popupRetrievalService.ts` — chunk result cache

### 1.9 Hover/long-press prefetch
- On selection start (mousedown/touchstart), begin `buildPopupContextBundle()` immediately
- By the time popup opens (mouseup + UI render), context is warm
- Cancel on scroll or drag-away

**Files:**
- `src/app/reader/components/annotator/` — selection event handlers
- New: `src/services/contextTranslation/prefetchService.ts` — manages prefetch lifecycle

### 1.10 Streaming parser optimization
- Current: `parseStreamingTranslationResponse()` re-scans from beginning on every chunk → O(n²)
- Fix: track last parse position, only scan new content for open/close tags
- Resume-based parser with state: `{ lastOffset, openFields }`

**Files:**
- `src/services/contextTranslation/responseParser.ts` — incremental parser

## Phase 1: Per-field Prompting

### 1.11 Field strategy setting
- Add `fieldStrategy: 'single' | 'multi'` to translation settings
- `'single'` = current behavior (one LLM call, all fields)
- `'multi'` = per-field prompts, parallel LLM calls
- Default: `'single'`

### 1.12 Per-field prompt builder
- `buildPerFieldPrompt(field, request)` generates a focused system+user prompt for one field
- Simpler output format: no XML tags needed, just raw text response
- Each field prompt includes same context (selected text, book context, dictionary)
- translation prompt: "Translate X to Y"
- contextualMeaning prompt: "Given the context, explain what X means in Y"
- examples prompt: "Give 2-3 example sentences using X in Y"

**Files:**
- `src/services/contextTranslation/promptBuilder.ts` — `buildPerFieldPrompt()`
- `src/services/contextTranslation/translationService.ts` — `streamPerFieldTranslation()`

### 1.13 Parallel field streaming
- Launch N parallel `streamLLM()` calls (one per enabled field)
- Each stream feeds into its own result slot
- UI renders each field independently as it arrives
- Validation per-field, repair per-field (only retry the failed one)
- **Cost warning**: Show a note in settings that multi-field mode uses N API calls per lookup. For paid API users this is a 3-4x cost multiplier.

**Files:**
- `src/services/contextTranslation/translationService.ts` — new parallel streamer
- `src/hooks/useContextLookup.ts` — merge parallel partial results
- `src/services/contextTranslation/validator.ts` — per-field validation
- `src/components/settings/AITranslatePanel.tsx` — cost warning text next to multi-field toggle

## Phase 1: Dictionary Improvements

### 1.14 Hybrid display mode
- Show dictionary matches directly in the popup as a collapsible "Dictionary" section
- Rendered immediately (no LLM needed) — user sees instant definitions
- AI translation streams in separately below
- Dictionary results shown with source attribution (e.g., "CC-CEDICT", "JMdict")

**Files:**
- `src/app/reader/components/annotator/ContextTranslationPopup.tsx` — dictionary section
- `src/app/reader/components/annotator/ContextDictionaryPopup.tsx` — same
- `src/services/contextTranslation/types.ts` — `PopupContextBundle.dictionaryResults` typed

### 1.15 Deconjugation via kuromoji basic_form
- Before dictionary lookup, run Japanese text through kuromoji tokenizer
- Use `basic_form` field to get dictionary form (e.g., 食べた → 食べる)
- Look up dictionary form instead of conjugated surface form
- Also pass conjugation info to the LLM prompt for better context

**Files:**
- `src/services/contextTranslation/dictionaryService.ts` — deconjugate before lookup
- `src/services/contextTranslation/plugins/jpTokenizer.ts` — export `getDictionaryForm()`

### 1.16 New dictionary import formats
- **EPWING**: Common for Japanese learner dictionaries (大辞林, 新明解)
- **DSL (ABBYY Lingvo)**: Popular for European language pairs
- **MDict (.mdx)**: Widely used in Chinese learning community
- Add format detection in import flow (by file extension / magic bytes)
- Each format gets its own parser module alongside existing `dictionaryParser.ts`

**Files:**
- `src/services/contextTranslation/dictionaryParser.ts` — refactor to format router
- New: `src/services/contextTranslation/parsers/epwingParser.ts`
- New: `src/services/contextTranslation/parsers/dslParser.ts`
- New: `src/services/contextTranslation/parsers/mdictParser.ts`
- `src/components/settings/AITranslatePanel.tsx` — format-aware import UI

## Phase 1: Any-to-Any Translation Quality

### 1.17 Language-pair-aware prompts
- Current prompts are generic — same template for cn→en, en→jp, fr→ru
- Add language-pair-specific prompt hints:
  - CJK→Latin: emphasize word boundaries, compound decomposition
  - Latin→CJK: emphasize register/formality selection
  - Same-family pairs (es→pt, de→nl): emphasize false friends
  - RTL→LTR: explicit direction handling in examples
- Configurable via a `languagePairHints` registry

**Files:**
- New: `src/services/contextTranslation/languagePairHints.ts`
- `src/services/contextTranslation/promptBuilder.ts` — inject pair-specific hints

### 1.18 Improved language detection
- Current `franc` works poorly on short text (<20 chars typical of selection)
- Supplement with script analysis (already partially done) + bigram frequency for Latin scripts
- Add user override: if user set the book's language, trust it over detection
- Pass book metadata language as strong prior

**Files:**
- `src/services/contextTranslation/languagePolicy.ts` — enhanced detection
- `src/hooks/useContextLookup.ts` — pass book language metadata

### 1.19 Cross-language example quality
- For non-CJK target languages, examples currently just get LLM text
- Add post-validation: example target text should match target language script
- Detect and reject examples where the LLM mixed languages

**Files:**
- `src/services/contextTranslation/exampleFormatter.ts` — language validation
- `src/services/contextTranslation/validator.ts` — example language check

### 1.20 Offline-only dictionary fallback
- When no AI provider is configured or available, popup still works as a pure dictionary lookup
- Show a subtle banner: "AI translation unavailable — showing dictionary results only"
- All deterministic features remain active: pinyin, romaji, dictionary definitions, deconjugation
- Degrades gracefully: no examples, no contextualMeaning, no RAG — just dictionary + phonetics

**Files:**
- `src/hooks/useContextLookup.ts` — provider availability check, fallback path
- `src/app/reader/components/annotator/ContextTranslationPopup.tsx` — "AI unavailable" banner
- `src/app/reader/components/annotator/ContextDictionaryPopup.tsx` — same

### 1.21 Smart word-boundary expansion (togglable)
- Users often select partial words or miss a character in CJK compounds
- Expand selection to word boundary before dictionary lookup + LLM call:
  - **Japanese**: kuromoji tokenizer boundaries
  - **Chinese**: jieba-style segmentation (investigate `jieba-wasm` or `nodejieba`)
  - **Latin scripts**: expand to whitespace/punctuation boundaries
- Setting: "Auto-expand selection to word boundary" toggle (default: on)
- Show the expanded text in popup header so user can see what was actually looked up

**Files:**
- New: `src/services/contextTranslation/selectionExpander.ts` — language-aware expansion
- `src/services/contextTranslation/plugins/jpTokenizer.ts` — export word boundary detection
- `src/hooks/useContextLookup.ts` — expand before lookup
- `src/components/settings/AITranslatePanel.tsx` — toggle

### 1.22 Popup lookup history (sidebar)
- Tapping a word inside an example or definition currently loses the previous result
- Maintain a lookup stack: each new sub-lookup pushes onto stack
- Show a compact history list in the reader sidebar (chronological, most recent first)
- Each entry: selected text, translation, timestamp, book title
- Back button in popup navigates the stack
- History persists per reading session (cleared on book close, or optionally persisted to book annotations)

**Files:**
- New: `src/services/contextTranslation/lookupHistoryService.ts` — stack + session storage
- `src/app/reader/components/annotator/ContextTranslationPopup.tsx` — back button, sub-lookup push
- `src/app/reader/components/sidebar/` — lookup history panel
- `src/hooks/useContextLookup.ts` — push results to history

### 1.23 Prompt test harness
- Structured test runner for evaluating translation quality across language pairs and models
- Test fixtures: `(source_text, source_lang, target_lang, book_context?, expected_fields?)` tuples
- Run against any configured provider/model
- Output: per-field results, latency, token count
- Agent-based review: spin up review agents that score outputs on accuracy, fluency, completeness
- Results stored as JSON for comparison across prompt iterations and models
- Covers top 30 language pairs (forward AND reverse = 60 directions) with 50 test cases each (3000 total)

**Files:**
- New: `src/services/contextTranslation/__tests__/promptTestHarness.ts` — test runner
- New: `src/services/contextTranslation/__tests__/fixtures/` — per-language-pair test cases
- New: `scripts/run-prompt-eval.ts` — CLI entry point for batch evaluation

Spin up agents to write language-pair-specific prompts for top 30 language pairs

Test translation quality with all models loadable on local llama.cpp

Closed loop refinement of prompts and harness based on error analysis of mistranslations in difficult pairs (e.g., Arabic→English, Japanese→French)

Manual review of translations by various agents is the evaluation bar — not automated heuristics alone

REMEMBER TO UNLOAD CURRENT MODEL ON LOCALHOST:8081 BEFORE TESTING NEW ONES TO AVOID MEMORY ISSUES
---

## Phase 2: Language Learning Features

### 2.1 Grammar hints in popup
- When user selects text, show grammatical analysis alongside translation
- For Japanese: use kuromoji POS tags (e.g., "動詞・一段・連用形" → "Ichidan verb, continuative form")
- For other languages: add as an LLM field ("grammatical role in this sentence")
- Show as a subtle tag below the selected text (e.g., "verb · past tense")

### 2.2 TTS pronunciation in popup
- Add a speaker icon next to the selected text in the popup
- On click: use Web Speech API (`speechSynthesis`) for immediate playback
- Language tag from detection → select appropriate voice
- For CJK: TTS the original text AND the romanized version

### 2.3 Improved vocabulary review
- Current: basic SM-2 flashcard with reveal/pass/fail
- Add quiz modes: multiple choice, fill-in-the-blank, listening (TTS plays, user types)
- Add reverse cards: show translation → recall source word
- Add example-based cards: show example with blank, user fills from context
- Session stats: accuracy rate, streak, time per card

### 2.4 Reading comprehension questions
- After finishing a chapter/section, offer "Check Your Understanding" questions
- LLM generates questions from RAG-retrieved content for that section
- Multiple choice + short answer formats
- Spoiler-safe: only asks about content up to current page
- Track comprehension score per book

### 2.5 Word frequency / importance indicators
- Tag vocabulary by CEFR level or frequency rank (using bundled frequency lists)
- Show in popup: "A2" or "top 1000" badge for the selected word
- Helps learners prioritize which words to save and study
- Available for: en, fr, de, es, ja (JLPT levels), zh (HSK levels)

### 2.6 Contextual grammar explanations
- When the popup shows a conjugated form, link to the grammar pattern
- e.g., "食べた" → "Past tense of 食べる (Ichidan verb). Pattern: stem + た"
- Could be deterministic for structured languages (ja via kuromoji) or LLM-assisted

---

## Verification

### Phase 1 verification
1. Unit tests for each new provider (Anthropic, Google) with mock responses
2. Integration test: configure provider list with 2+ entries, verify task routing picks correct one
3. Latency benchmark: measure time-to-first-token before and after parallelization changes using llama.cpp on localhost:8081
4. Per-field prompting test: run same query in single vs multi mode, compare output quality and latency
5. Dictionary hybrid test: verify dictionary results appear instantly, AI streams in after
6. Deconjugation test: "食べた" → finds "食べる" in dictionary
7. Any-to-any test matrix: run translation for 10 language pairs, verify XML parsing + validation passes
8. Import format tests: import sample StarDict, EPWING, DSL, MDict files and verify entry counts
9. Offline fallback test: disable AI provider, verify dictionary-only popup renders with "AI unavailable" banner
10. Word expansion test: partial CJK selection expands to full word, Latin partial expands to whitespace boundary
11. Lookup history test: sub-lookup pushes to stack, back button restores previous, sidebar shows chronological list
12. Prompt test harness: run eval suite for 30 language pairs × 2 directions × 50 test cases (3000 total), agent review scores > threshold

### Phase 2 verification
1. Grammar hints: verify kuromoji POS tags render correctly for Japanese
2. TTS: verify Web Speech API plays correct language voice
3. Vocab review: test SM-2 scheduling + quiz mode scoring
4. Comprehension: verify questions are spoiler-safe (only reference read content)

## Decisions
- Phase 1 is the priority; Phase 2 items are stretch goals but should be completed fully anyway
- Per-field prompting defaults to `'single'` (current behavior) — `'multi'` is opt-in for weak models. Cost warning shown in settings for multi mode.
- Dictionary deconjugation is Japanese-first (kuromoji already available); other languages are not deferred, but more research needed on best approach per language
- Hover prefetch must be careful about battery/CPU on mobile — add a settings toggle
- EPWING parser: use Tauri Rust command (easier to maintain than WASM, leverages existing IPC, keeps renderer bundle small)
- `@ai-sdk/anthropic` and `@ai-sdk/google` are runtime dependencies — increases bundle size ~50KB each
- Smart word expansion is togglable (default: on) — some users may prefer exact selection behavior
- Offline dictionary fallback shows "AI unavailable" banner; all deterministic features stay active
- Lookup history lives in sidebar, persists per reading session
- Provider architecture: only need `@ai-sdk/openai-compatible` as catch-all + individual packages for proprietary APIs (Anthropic, Google). OpenRouter as meta-provider option.
- Prompt quality evaluation: manual review by agents, not automated heuristics alone. Prompt test harness produces structured output for agent scoring.
- No settings migration needed — clean slate, almost no users

## Further Considerations
1. **Dictionary format priority**: EPWING is mainly Japanese; MDict is mainly Chinese; DSL is mainly European. Equality for all languages — stagger implementation one at a time while keeping the codebase flexible for all formats.
2. **Prefetch aggressiveness**: Only pre-build context bundle (not LLM stream). Safer for resource usage, especially for paid API users.
3. **Chinese word segmentation for 1.21**: Need to evaluate `jieba-wasm` vs `@aspect-build/jieba` vs a Rust-side segmenter via Tauri command. Same decision axis as EPWING — whatever is easier to maintain.
4. **OpenRouter as default recommendation**: For non-technical users, OpenRouter is the simplest cloud setup (one API key → all models). Consider making it the suggested first provider in onboarding.
