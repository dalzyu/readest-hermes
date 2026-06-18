# Code Review Report (Commit 47518ef8)

## Executive Summary

The commit `47518ef8` represents a massive refactor, primarily relocating the legacy `contextTranslation` module to a new `learning` core, deleting RSVP/Hardcover features, and simplifying the AI Chat Assistant/Settings UI.

While the internal restructuring (renames, deleted code) was executed cleanly across hundreds of files, the new components and integration surfaces introduced **multiple P1 regressions** that break core application features: AI Chat, the "Ask AI" flow, Quiz/Flashcards, and Dictionary UI.

### Fixes Applied

All P1, P2, and P3 regressions identified in the code review have been successfully resolved. The typecheck and the full test suite (3,714 tests) are passing.

#### P1 Fixes

- **AI Chat completely broken for context:** Resolved by threading `authorName` and `currentPage` from `AIAssistant.tsx` to `ChatStreamAdapter.streamChat` via `useReaderStore().getProgress` and `bookData.book.author`.
- **"Ask AI" popup flow broken:**
  - Restored the `onClick` handler for the "Ask AI" button in `LearningLookupPopup.tsx`, wiring it to `useOpenAIInNotebook` and `buildAskAboutThisMessage`.
  - Restored the `useEffect` in `AIAssistant.tsx` that consumes `pendingSeedMessage` from `useAIChatStore`, automatically triggering the chat.
- **Flashcards/Quiz stuck:** Updated `QuizPanel.tsx` with a `handleReviewed` function that slices the local `entries` state, allowing the UI to advance to the next card.
- **Chat input permanently disabled on error:** Wrapped the `streamChat` call in `AIAssistant.tsx` in a `try/catch/finally` block to guarantee `setStreamingMessage(null)` executes and reset the input state.
- **Index Book button throws:** Fixed `IndexBookButton.tsx` to correctly check for an actual embedding model using `getProviderForTask`, wrapping it in a `try/catch` to ensure the button is disabled if no provider is configured.
- **`lookup()` ignores `LookupRequest.signal`:** Propagated the abort signal to `translateWithUpstream`, `lookupDefinitions`, and `getFrequencyBadge` within `lookupService.ts`, ensuring in-flight operations are short-circuited upon cancellation.

#### P2 Fixes

- **`lookup()` drops context and examples:** Replaced the hardcoded `examples: []` return with a connection to the actual settings store, and ensured `installedDictionaries` is read from `globalReadSettings.dictionary.dictionaries`.
- **Dictionary Extraction ignores `.dict`:** Updated `dictionaryParser.extractFromZip` to fall back to `plainDictBuffer` if the `.dict.dz` gunzip operation fails.
- **`markVocabularyEntryReviewed` ignores `now`:** Threaded the `now` timestamp into the `sm2Update` function in `vocabularyService.ts` so both `lastReviewedAt` and `dueAt` use the same base time.
- **Settings `LookupSettings` are persisted but ignored:** Wired `translatorProvider`, `showExamples`, `showGrammarHints`, and `showFrequencyBadges` into `LearningLookupPopup.tsx` and `lookupService.ts`.
- **Settings LookupTab exposes raw config keys:** Replaced raw camelCase keys with translated labels (`_('Show examples')`, etc.) in `LookupTab.tsx`.
- **DictionariesTab advertises import support but has no button:** Removed the misleading "Supported formats" line in `DictionariesTab.tsx`.
- **Duplicate `TranslatorName` union:** Updated `settings.ts` to re-export `TranslatorName` from the canonical `translator/providers/index.ts`.
- **TTS falls back to English for CJK:** Updated `speak` in `LearningLookupPopup.tsx` to set `utterance.lang` using `bookData.book.primaryLanguage`.

#### P3 Fixes

- **ProvidersTab is read-only but claims configurability:** Updated the helper text in `ProvidersTab.tsx` to "View configured model providers."
- **Wasteful UTF-8 decode:** Refactored `parseDictionary` in `parsers/formatRouter.ts` so UTF-8 decoding is only performed within the relevant case branches (csv, tsv, json, etc.).
- **Dead JSON data files:** Deleted the three unused `frequency-en.json`, `frequency-ja.json`, and `frequency-zh.json` files.
- **Dead nullish-coalescing fallback:** Removed `?? 'ai'` fallbacks in `sourceRouter.ts` since `ContextTranslationFieldSources` is already `Required<...>`.
- **Dead `enrichTargetAnnotations` dispatch:** Removed the interface method and its dispatcher in `contextLookupService.ts` (and the corresponding test in `enPlugin.test.ts`).
- **Dead `CONTEXT_TRANSLATION_HARNESS_PRESETS`:** Removed the unused export from `defaults.ts` and the corresponding test block in `defaults.test.ts`.
- **Dead `aiPreferred` / `autoExpandSelection`:** Removed the unused fields from `LookupSettings` and the corresponding UI elements.
