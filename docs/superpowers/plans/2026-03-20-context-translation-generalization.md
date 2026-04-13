# Context Translation Generalization Implementation Plan

> **For agentic workers:** REQUIRED: Use superpowers:subagent-driven-development (if subagents available) or superpowers:executing-plans to implement this plan. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Generalize the context-aware translation popup into an any-to-any, schema-validated translation flow with language plugins, and add a separate source-language dictionary popup.

**Architecture:** Build a shared `contextLookupService` plus `useContextLookup` hook that both translation and dictionary mode use. For v1, keep the current text-only LLM transport and standardize on JSON-in-text wrapped in `<lookup_json>...</lookup_json>` for final parsing, while translation mode can retain compatibility partial streaming and dictionary mode can ship as final-result-first.

**Tech Stack:** React 19, TypeScript, Vitest, existing Readest popup UI, current AI provider abstraction, text-streaming LLM wrapper in `apps/readest-app/src/services/contextTranslation/llmClient.ts`.

---

## File Map

### Existing files to modify

- `apps/readest-app/src/services/contextTranslation/types.ts`
- `apps/readest-app/src/services/contextTranslation/defaults.ts`
- `apps/readest-app/src/services/contextTranslation/promptBuilder.ts`
- `apps/readest-app/src/services/contextTranslation/responseParser.ts`
- `apps/readest-app/src/services/contextTranslation/translationService.ts`
- `apps/readest-app/src/services/contextTranslation/exampleFormatter.ts`
- `apps/readest-app/src/services/contextTranslation/llmClient.ts`
- `apps/readest-app/src/hooks/useContextTranslation.ts`
- `apps/readest-app/src/utils/lang.ts`
- `apps/readest-app/src/app/reader/components/annotator/ContextTranslationPopup.tsx`
- `apps/readest-app/src/app/reader/components/annotator/Annotator.tsx`
- `apps/readest-app/src/components/settings/AIPanel.tsx`
- `apps/readest-app/src/components/settings/SettingsPanel.tsx`
- `apps/readest-app/src/types/settings.ts`
- `apps/readest-app/src/app/reader/components/notebook/VocabularyPanel.tsx`
- `apps/readest-app/src/services/contextTranslation/vocabularyService.ts`

### New files to create

- `apps/readest-app/src/services/contextTranslation/modes.ts`
- `apps/readest-app/src/services/contextTranslation/contextLookupService.ts`
- `apps/readest-app/src/services/contextTranslation/languagePolicy.ts`
- `apps/readest-app/src/services/contextTranslation/normalizer.ts`
- `apps/readest-app/src/services/contextTranslation/validator.ts`
- `apps/readest-app/src/services/contextTranslation/repairPromptBuilder.ts`
- `apps/readest-app/src/services/contextTranslation/plugins/types.ts`
- `apps/readest-app/src/services/contextTranslation/plugins/registry.ts`
- `apps/readest-app/src/services/contextTranslation/plugins/fallbackPlugin.ts`
- `apps/readest-app/src/services/contextTranslation/plugins/zhPlugin.ts`
- `apps/readest-app/src/services/contextTranslation/plugins/enPlugin.ts`
- `apps/readest-app/src/services/contextTranslation/vocabularyCompatibility.ts`
- `apps/readest-app/src/hooks/useContextLookup.ts`
- `apps/readest-app/src/hooks/useContextDictionary.ts`
- `apps/readest-app/src/app/reader/components/annotator/ContextDictionaryPopup.tsx`

### Tests to create or expand

- `apps/readest-app/src/__tests__/contextTranslation/languagePolicy.test.ts`
- `apps/readest-app/src/__tests__/contextTranslation/contextLookupService.test.ts`
- `apps/readest-app/src/__tests__/contextTranslation/normalizer.test.ts`
- `apps/readest-app/src/__tests__/contextTranslation/validator.test.ts`
- `apps/readest-app/src/__tests__/contextTranslation/repairPromptBuilder.test.ts`
- `apps/readest-app/src/__tests__/contextTranslation/pluginRegistry.test.ts`
- `apps/readest-app/src/__tests__/contextTranslation/zhPlugin.test.ts`
- `apps/readest-app/src/__tests__/contextTranslation/enPlugin.test.ts`
- `apps/readest-app/src/__tests__/hooks/useContextLookup.test.ts`
- `apps/readest-app/src/__tests__/hooks/useContextDictionary.test.ts`
- `apps/readest-app/src/__tests__/components/ContextDictionaryPopup.test.tsx`
- expand the existing `defaults`, `promptBuilder`, `responseParser`, `translationService`, `useContextTranslation`, `vocabularyService`, and `ContextTranslationPopup` tests

## Chunk 1: Modes, Settings, And Language Policy

### Task 1: Define mode-aware models and settings

**Files:**
- Create: `apps/readest-app/src/services/contextTranslation/modes.ts`
- Modify: `apps/readest-app/src/services/contextTranslation/types.ts`
- Modify: `apps/readest-app/src/services/contextTranslation/defaults.ts`
- Modify: `apps/readest-app/src/types/settings.ts`
- Test: `apps/readest-app/src/__tests__/contextTranslation/defaults.test.ts`

- [ ] **Step 1: Write the failing tests**

```ts
test('exposes translation and dictionary mode ids', () => {
  expect(CONTEXT_LOOKUP_MODES).toEqual(['translation', 'dictionary']);
});

test('provides dictionary defaults separate from translation defaults', () => {
  expect(DEFAULT_CONTEXT_DICTIONARY_SETTINGS.enabled).toBe(false);
  expect(DEFAULT_CONTEXT_TRANSLATION_SETTINGS.targetLanguage).toBe('en');
});
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `corepack pnpm --filter @readest/readest-app test -- --run src/__tests__/contextTranslation/defaults.test.ts`
Expected: FAIL with missing mode/default exports.

- [ ] **Step 3: Implement minimal mode and settings types**

```ts
export type ContextLookupMode = 'translation' | 'dictionary';

export interface ContextDictionarySettings {
  enabled: boolean;
  sourceExamples: boolean;
}
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `corepack pnpm --filter @readest/readest-app test -- --run src/__tests__/contextTranslation/defaults.test.ts`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add apps/readest-app/src/services/contextTranslation/modes.ts apps/readest-app/src/services/contextTranslation/types.ts apps/readest-app/src/services/contextTranslation/defaults.ts apps/readest-app/src/types/settings.ts apps/readest-app/src/__tests__/contextTranslation/defaults.test.ts
git commit -m "refactor: add mode-aware context lookup settings"
```

### Task 2: Add locale normalization, detection integration, and fallback resolution

**Files:**
- Create: `apps/readest-app/src/services/contextTranslation/languagePolicy.ts`
- Modify: `apps/readest-app/src/utils/lang.ts`
- Test: `apps/readest-app/src/__tests__/contextTranslation/languagePolicy.test.ts`

- [ ] **Step 1: Write the failing tests**

```ts
test('normalizes locale tags for plugin lookup', () => {
  expect(resolvePluginLanguage('zh-Hans-CN')).toEqual(['zh-Hans-CN', 'zh-Hans', 'zh', 'fallback']);
});

test('returns detector info with language, confidence, and mixed flag', () => {
  expect(detectLookupLanguage('hello 世界')).toEqual(
    expect.objectContaining({ language: expect.any(String), confidence: expect.any(Number), mixed: true }),
  );
});
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `corepack pnpm --filter @readest/readest-app test -- --run src/__tests__/contextTranslation/languagePolicy.test.ts`
Expected: FAIL with missing helpers.

- [ ] **Step 3: Implement `languagePolicy.ts` on top of `utils/lang.ts`**

```ts
type DetectedLanguageInfo = {
  language: string;
  confidence: number;
  mixed: boolean;
};
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `corepack pnpm --filter @readest/readest-app test -- --run src/__tests__/contextTranslation/languagePolicy.test.ts`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add apps/readest-app/src/services/contextTranslation/languagePolicy.ts apps/readest-app/src/utils/lang.ts apps/readest-app/src/__tests__/contextTranslation/languagePolicy.test.ts
git commit -m "feat: add language policy for context lookup"
```

### Chunk 1 Verification Gate

- [ ] **Step 1: Run typecheck and lint**

Run: `corepack pnpm --filter @readest/readest-app lint`
Expected: PASS

- [ ] **Step 2: Run typecheck**

Run: `corepack pnpm --filter @readest/readest-app typecheck`
Fallback: `corepack pnpm --filter @readest/readest-app exec tsc --noEmit`
Expected: PASS

- [ ] **Step 3: Fix any type fallout before moving on**

```ts
// Keep the app compiling between chunks.
```

## Chunk 2: Transport, Normalization, And Validation

### Task 3: Add repo-compatible structured transport and normalization

**Files:**
- Create: `apps/readest-app/src/services/contextTranslation/normalizer.ts`
- Modify: `apps/readest-app/src/services/contextTranslation/llmClient.ts`
- Modify: `apps/readest-app/src/services/contextTranslation/responseParser.ts`
- Modify: `apps/readest-app/src/services/contextTranslation/promptBuilder.ts`
- Test: `apps/readest-app/src/__tests__/contextTranslation/normalizer.test.ts`
- Test: `apps/readest-app/src/__tests__/contextTranslation/promptBuilder.test.ts`
- Test: `apps/readest-app/src/__tests__/contextTranslation/responseParser.test.ts`

- [ ] **Step 1: Write the failing tests**

```ts
test('normalizes sentinel-delimited JSON-in-text into the translation model', () => {
  expect(normalizeLookupResponse('<lookup_json>{"translation":"翻译"}</lookup_json>', 'translation').translation).toBe('翻译');
});

test('translation prompt requires final sentinel-wrapped JSON output', () => {
  expect(buildLookupPrompt({ mode: 'translation', ...request })).toContain('<lookup_json>');
});

test('falls back from tagged text into the same model', () => {
  expect(normalizeLookupResponse('<translation>bonjour</translation>', 'translation').translation).toBe('bonjour');
});
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `corepack pnpm --filter @readest/readest-app test -- --run src/__tests__/contextTranslation/normalizer.test.ts src/__tests__/contextTranslation/promptBuilder.test.ts src/__tests__/contextTranslation/responseParser.test.ts`
Expected: FAIL with missing normalizer and stale prompt assumptions.

- [ ] **Step 3: Implement v1 transport as JSON-in-text**

```ts
export function normalizeLookupResponse(raw: string, mode: ContextLookupMode): NormalizedLookupResult {
  const json = extractLookupJson(raw);
  return json ? normalizeStructuredJson(json, mode) : normalizeTaggedFallback(raw, mode);
}
```

Rules:

- final result payload uses `<lookup_json>...</lookup_json>`
- translation-mode partial streaming may keep the current tag-based parser until completion, then append one final `<lookup_json>...</lookup_json>` payload for authoritative parsing
- dictionary mode does not require partial streaming in v1
- do not introduce object-mode SDK calls

- [ ] **Step 4: Run the tests to verify they pass**

Run: `corepack pnpm --filter @readest/readest-app test -- --run src/__tests__/contextTranslation/normalizer.test.ts src/__tests__/contextTranslation/promptBuilder.test.ts src/__tests__/contextTranslation/responseParser.test.ts`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add apps/readest-app/src/services/contextTranslation/normalizer.ts apps/readest-app/src/services/contextTranslation/llmClient.ts apps/readest-app/src/services/contextTranslation/responseParser.ts apps/readest-app/src/services/contextTranslation/promptBuilder.ts apps/readest-app/src/__tests__/contextTranslation/normalizer.test.ts apps/readest-app/src/__tests__/contextTranslation/promptBuilder.test.ts apps/readest-app/src/__tests__/contextTranslation/responseParser.test.ts
git commit -m "refactor: add structured text transport for context lookup"
```

### Task 4: Add shared lookup service, validation states, and repair prompts

**Files:**
- Create: `apps/readest-app/src/services/contextTranslation/contextLookupService.ts`
- Create: `apps/readest-app/src/services/contextTranslation/validator.ts`
- Create: `apps/readest-app/src/services/contextTranslation/repairPromptBuilder.ts`
- Test: `apps/readest-app/src/__tests__/contextTranslation/contextLookupService.test.ts`
- Test: `apps/readest-app/src/__tests__/contextTranslation/validator.test.ts`
- Test: `apps/readest-app/src/__tests__/contextTranslation/repairPromptBuilder.test.ts`

- [ ] **Step 1: Write the failing tests**

```ts
test('shared lookup service detects language, builds prompts, validates, and returns normalized output', async () => {
  const result = await runContextLookup({ mode: 'translation', ...request });
  expect(result.language.source).toBeDefined();
});

test('marks echoed source text as warning when it matches a proper noun allow-rule', () => {
  expect(validateTranslationResult(namedEntityResult).decision).toBe('accept-with-warning');
});
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `corepack pnpm --filter @readest/readest-app test -- --run src/__tests__/contextTranslation/contextLookupService.test.ts src/__tests__/contextTranslation/validator.test.ts src/__tests__/contextTranslation/repairPromptBuilder.test.ts`
Expected: FAIL with missing service/validator/repair helpers.

- [ ] **Step 3: Implement the shared orchestration layer**

```ts
export async function runContextLookup(input: ContextLookupRequest): Promise<ContextLookupResult> {
  const detected = detectLookupLanguage(input.selectedText, input.popupContext);
  const raw = await callLLM(...);
  const normalized = normalizeLookupResponse(raw, input.mode);
  return validateAndEnrich(normalized, detected, input.mode);
}
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `corepack pnpm --filter @readest/readest-app test -- --run src/__tests__/contextTranslation/contextLookupService.test.ts src/__tests__/contextTranslation/validator.test.ts src/__tests__/contextTranslation/repairPromptBuilder.test.ts`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add apps/readest-app/src/services/contextTranslation/contextLookupService.ts apps/readest-app/src/services/contextTranslation/validator.ts apps/readest-app/src/services/contextTranslation/repairPromptBuilder.ts apps/readest-app/src/__tests__/contextTranslation/contextLookupService.test.ts apps/readest-app/src/__tests__/contextTranslation/validator.test.ts apps/readest-app/src/__tests__/contextTranslation/repairPromptBuilder.test.ts
git commit -m "feat: add shared context lookup pipeline"
```

### Task 5: Add plugin registry, source/target annotation slots, and v1 plugins

**Files:**
- Create: `apps/readest-app/src/services/contextTranslation/plugins/types.ts`
- Create: `apps/readest-app/src/services/contextTranslation/plugins/registry.ts`
- Create: `apps/readest-app/src/services/contextTranslation/plugins/fallbackPlugin.ts`
- Create: `apps/readest-app/src/services/contextTranslation/plugins/zhPlugin.ts`
- Create: `apps/readest-app/src/services/contextTranslation/plugins/enPlugin.ts`
- Test: `apps/readest-app/src/__tests__/contextTranslation/pluginRegistry.test.ts`
- Test: `apps/readest-app/src/__tests__/contextTranslation/zhPlugin.test.ts`
- Test: `apps/readest-app/src/__tests__/contextTranslation/enPlugin.test.ts`

- [ ] **Step 1: Write the failing tests**

```ts
test('resolves target and source plugins independently', () => {
  const resolved = resolveLookupPlugins({ sourceLanguage: 'zh-Hans', targetLanguage: 'en-US', mode: 'translation' });
  expect(resolved.source.language).toBe('zh');
  expect(resolved.target.language).toBe('en');
});

test('english plugin is a no-op for v1 annotations', () => {
  expect(enrichEnglishAnnotations(baseResult).annotations?.target).toBeUndefined();
});
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `corepack pnpm --filter @readest/readest-app test -- --run src/__tests__/contextTranslation/pluginRegistry.test.ts src/__tests__/contextTranslation/zhPlugin.test.ts src/__tests__/contextTranslation/enPlugin.test.ts`
Expected: FAIL with missing registry and plugin modules.

- [ ] **Step 3: Implement the plugin layer**

```ts
type LookupAnnotationSlots = {
  source?: LookupAnnotations;
  target?: LookupAnnotations;
};
```

Rules:

- plugins emit data only; popup components own rendering
- `zh` plugin provides pinyin-oriented enrichment for supported fields
- `en` plugin is intentionally minimal/no-op in v1
- example annotations must link by `exampleId`, not index position alone

- [ ] **Step 4: Run the tests to verify they pass**

Run: `corepack pnpm --filter @readest/readest-app test -- --run src/__tests__/contextTranslation/pluginRegistry.test.ts src/__tests__/contextTranslation/zhPlugin.test.ts src/__tests__/contextTranslation/enPlugin.test.ts`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add apps/readest-app/src/services/contextTranslation/plugins/types.ts apps/readest-app/src/services/contextTranslation/plugins/registry.ts apps/readest-app/src/services/contextTranslation/plugins/fallbackPlugin.ts apps/readest-app/src/services/contextTranslation/plugins/zhPlugin.ts apps/readest-app/src/services/contextTranslation/plugins/enPlugin.ts apps/readest-app/src/__tests__/contextTranslation/pluginRegistry.test.ts apps/readest-app/src/__tests__/contextTranslation/zhPlugin.test.ts apps/readest-app/src/__tests__/contextTranslation/enPlugin.test.ts
git commit -m "feat: add context lookup language plugins"
```

### Chunk 2 Verification Gate

- [ ] **Step 1: Run typecheck and focused regression tests**

Run: `corepack pnpm --filter @readest/readest-app test -- --run src/__tests__/contextTranslation/normalizer.test.ts src/__tests__/contextTranslation/contextLookupService.test.ts src/__tests__/contextTranslation/pluginRegistry.test.ts`
Expected: PASS

- [ ] **Step 2: Run lint**

Run: `corepack pnpm --filter @readest/readest-app lint`
Expected: PASS

- [ ] **Step 3: Run typecheck**

Run: `corepack pnpm --filter @readest/readest-app typecheck`
Fallback: `corepack pnpm --filter @readest/readest-app exec tsc --noEmit`
Expected: PASS

## Chunk 3: Translation Flow Migration

### Task 6: Create the shared hook and migrate translation data loading onto it

**Files:**
- Create: `apps/readest-app/src/hooks/useContextLookup.ts`
- Modify: `apps/readest-app/src/hooks/useContextTranslation.ts`
- Modify: `apps/readest-app/src/services/contextTranslation/translationService.ts`
- Test: `apps/readest-app/src/__tests__/hooks/useContextLookup.test.ts`
- Test: `apps/readest-app/src/__tests__/hooks/useContextTranslation.test.ts`

- [ ] **Step 1: Write the failing tests**

```ts
test('useContextLookup exposes mode-aware loading and validation state', async () => {
  const { result } = renderHook(() => useContextLookup({ mode: 'translation', ...props }));
  expect(result.current.validationDecision).toBeDefined();
});

test('useContextTranslation delegates to the shared lookup hook', async () => {
  expect(runContextLookup).toHaveBeenCalledWith(expect.objectContaining({ mode: 'translation' }));
});
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `corepack pnpm --filter @readest/readest-app test -- --run src/__tests__/hooks/useContextLookup.test.ts src/__tests__/hooks/useContextTranslation.test.ts`
Expected: FAIL with missing shared hook.

- [ ] **Step 3: Implement `useContextLookup` and migrate translation callers**

```ts
export function useContextLookup(input: UseContextLookupInput) {
  // shared async state, repair retries, plugin-enriched result, and telemetry hooks
}
```

Rules:

- `useContextTranslation` becomes a thin translation-mode wrapper for compatibility
- shared hook owns retry, accept-with-warning, and degrade behavior
- translation service becomes an adapter over `runContextLookup`

- [ ] **Step 4: Run the tests to verify they pass**

Run: `corepack pnpm --filter @readest/readest-app test -- --run src/__tests__/hooks/useContextLookup.test.ts src/__tests__/hooks/useContextTranslation.test.ts`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add apps/readest-app/src/hooks/useContextLookup.ts apps/readest-app/src/hooks/useContextTranslation.ts apps/readest-app/src/services/contextTranslation/translationService.ts apps/readest-app/src/__tests__/hooks/useContextLookup.test.ts apps/readest-app/src/__tests__/hooks/useContextTranslation.test.ts
git commit -m "refactor: route translation lookups through shared hook"
```

### Task 7: Migrate the translation popup to structured fields and annotation slots

**Files:**
- Modify: `apps/readest-app/src/app/reader/components/annotator/ContextTranslationPopup.tsx`
- Modify: `apps/readest-app/src/services/contextTranslation/exampleFormatter.ts`
- Test: `apps/readest-app/src/__tests__/components/ContextTranslationPopup.test.tsx`
- Test: `apps/readest-app/src/__tests__/contextTranslation/exampleFormatter.test.ts`

- [ ] **Step 1: Write the failing tests**

```tsx
test('renders usage examples from structured sourceText and targetText fields', () => {
  render(<ContextTranslationPopup result={translationResult} />);
  expect(screen.getByText('source example')).toBeInTheDocument();
  expect(screen.getByText('target example')).toBeInTheDocument();
});

test('renders plugin annotations without parsing language labels from example text', () => {
  render(<ContextTranslationPopup result={annotatedResult} />);
  expect(screen.getByText('grunnings')).toBeInTheDocument();
});
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `corepack pnpm --filter @readest/readest-app test -- --run src/__tests__/components/ContextTranslationPopup.test.tsx src/__tests__/contextTranslation/exampleFormatter.test.ts`
Expected: FAIL with tag/label-based rendering assumptions.

- [ ] **Step 3: Implement structured translation rendering**

```tsx
<UsageExample
  source={example.sourceText}
  target={example.targetText}
  sourceAnnotations={result.annotations?.source?.examples[example.exampleId]}
  targetAnnotations={result.annotations?.target?.examples[example.exampleId]}
/>
```

Rules:

- do not parse `Chinese:` or other language labels in popup code
- renderer reads normalized fields and annotation slots only
- offset handling uses the code-point contract from the spec

- [ ] **Step 4: Run the tests to verify they pass**

Run: `corepack pnpm --filter @readest/readest-app test -- --run src/__tests__/components/ContextTranslationPopup.test.tsx src/__tests__/contextTranslation/exampleFormatter.test.ts`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add apps/readest-app/src/app/reader/components/annotator/ContextTranslationPopup.tsx apps/readest-app/src/services/contextTranslation/exampleFormatter.ts apps/readest-app/src/__tests__/components/ContextTranslationPopup.test.tsx apps/readest-app/src/__tests__/contextTranslation/exampleFormatter.test.ts
git commit -m "refactor: render translation popup from structured lookup data"
```

### Chunk 3 Verification Gate

- [ ] **Step 1: Run popup and hook regressions**

Run: `corepack pnpm --filter @readest/readest-app test -- --run src/__tests__/hooks/useContextLookup.test.ts src/__tests__/hooks/useContextTranslation.test.ts src/__tests__/components/ContextTranslationPopup.test.tsx`
Expected: PASS

- [ ] **Step 2: Run lint**

Run: `corepack pnpm --filter @readest/readest-app lint`
Expected: PASS

- [ ] **Step 3: Run typecheck**

Run: `corepack pnpm --filter @readest/readest-app typecheck`
Fallback: `corepack pnpm --filter @readest/readest-app exec tsc --noEmit`
Expected: PASS

## Chunk 4: Dictionary Popup And UI Wiring

### Task 8: Add dictionary-mode hook and popup component

**Files:**
- Create: `apps/readest-app/src/hooks/useContextDictionary.ts`
- Create: `apps/readest-app/src/app/reader/components/annotator/ContextDictionaryPopup.tsx`
- Test: `apps/readest-app/src/__tests__/hooks/useContextDictionary.test.ts`
- Test: `apps/readest-app/src/__tests__/components/ContextDictionaryPopup.test.tsx`

- [ ] **Step 1: Write the failing tests**

```tsx
test('dictionary hook requests source-language explanations through the shared lookup hook', async () => {
  renderHook(() => useContextDictionary(props));
  expect(runContextLookup).toHaveBeenCalledWith(expect.objectContaining({ mode: 'dictionary' }));
});

test('dictionary popup renders simplified source-language explanation fields', () => {
  render(<ContextDictionaryPopup result={dictionaryResult} />);
  expect(screen.getByText('simple definition')).toBeInTheDocument();
});
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `corepack pnpm --filter @readest/readest-app test -- --run src/__tests__/hooks/useContextDictionary.test.ts src/__tests__/components/ContextDictionaryPopup.test.tsx`
Expected: FAIL with missing hook and popup.

- [ ] **Step 3: Implement dictionary-mode UI on top of the shared pipeline**

```ts
export function useContextDictionary(input: UseContextDictionaryInput) {
  return useContextLookup({ ...input, mode: 'dictionary' });
}
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `corepack pnpm --filter @readest/readest-app test -- --run src/__tests__/hooks/useContextDictionary.test.ts src/__tests__/components/ContextDictionaryPopup.test.tsx`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add apps/readest-app/src/hooks/useContextDictionary.ts apps/readest-app/src/app/reader/components/annotator/ContextDictionaryPopup.tsx apps/readest-app/src/__tests__/hooks/useContextDictionary.test.ts apps/readest-app/src/__tests__/components/ContextDictionaryPopup.test.tsx
git commit -m "feat: add dictionary mode popup"
```

### Task 9: Wire annotator, settings, and vocabulary entry points

**Files:**
- Modify: `apps/readest-app/src/app/reader/components/annotator/Annotator.tsx`
- Modify: `apps/readest-app/src/components/settings/AIPanel.tsx`
- Modify: `apps/readest-app/src/components/settings/SettingsPanel.tsx`
- Modify: `apps/readest-app/src/types/settings.ts`
- Test: `apps/readest-app/src/__tests__/components/Annotator.test.tsx`
- Test: `apps/readest-app/src/__tests__/components/settings/AIPanel.test.tsx`

- [ ] **Step 1: Write the failing tests**

```tsx
test('annotator can open translation and dictionary popups independently', () => {
  render(<Annotator {...props} />);
  expect(screen.getByRole('button', { name: /dictionary/i })).toBeInTheDocument();
});

test('ai panel persists dictionary settings separately from translation settings', () => {
  render(<AIPanel />);
  expect(screen.getByLabelText(/enable dictionary lookup/i)).toBeInTheDocument();
});
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `corepack pnpm --filter @readest/readest-app test -- --run src/__tests__/components/Annotator.test.tsx src/__tests__/components/settings/AIPanel.test.tsx`
Expected: FAIL with missing dictionary controls.

- [ ] **Step 3: Implement wiring**

Rules:

- translation and dictionary popups open from separate actions
- settings persist independently for each mode
- keep existing translation UX intact while adding the new dictionary entry point

- [ ] **Step 4: Run the tests to verify they pass**

Run: `corepack pnpm --filter @readest/readest-app test -- --run src/__tests__/components/Annotator.test.tsx src/__tests__/components/settings/AIPanel.test.tsx`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add apps/readest-app/src/app/reader/components/annotator/Annotator.tsx apps/readest-app/src/components/settings/AIPanel.tsx apps/readest-app/src/components/settings/SettingsPanel.tsx apps/readest-app/src/types/settings.ts apps/readest-app/src/__tests__/components/Annotator.test.tsx apps/readest-app/src/__tests__/components/settings/AIPanel.test.tsx
git commit -m "feat: wire dictionary lookup controls"
```

### Chunk 4 Verification Gate

- [ ] **Step 1: Run dictionary and annotator regressions**

Run: `corepack pnpm --filter @readest/readest-app test -- --run src/__tests__/hooks/useContextDictionary.test.ts src/__tests__/components/ContextDictionaryPopup.test.tsx src/__tests__/components/Annotator.test.tsx src/__tests__/components/settings/AIPanel.test.tsx`
Expected: PASS

- [ ] **Step 2: Run lint**

Run: `corepack pnpm --filter @readest/readest-app lint`
Expected: PASS

- [ ] **Step 3: Run typecheck**

Run: `corepack pnpm --filter @readest/readest-app typecheck`
Fallback: `corepack pnpm --filter @readest/readest-app exec tsc --noEmit`
Expected: PASS

## Chunk 5: Compatibility, Telemetry, And Final Regression

### Task 10: Add vocabulary compatibility, annotation persistence, and migration guards

**Files:**
- Create: `apps/readest-app/src/services/contextTranslation/vocabularyCompatibility.ts`
- Modify: `apps/readest-app/src/services/contextTranslation/vocabularyService.ts`
- Modify: `apps/readest-app/src/services/contextTranslation/types.ts`
- Test: `apps/readest-app/src/__tests__/contextTranslation/vocabularyCompatibility.test.ts`
- Test: `apps/readest-app/src/__tests__/contextTranslation/vocabularyService.test.ts`

- [ ] **Step 1: Write the failing tests**

```ts
test('upgrades legacy saved translation records into structured lookup data', () => {
  expect(upgradeSavedVocabularyEntry(legacyEntry).mode).toBe('translation');
});

test('preserves example annotation linkage by exampleId during save and load', async () => {
  const entry = await saveVocabularyEntry(structuredEntry);
  expect(entry.examples[0].exampleId).toBeDefined();
});
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `corepack pnpm --filter @readest/readest-app test -- --run src/__tests__/contextTranslation/vocabularyCompatibility.test.ts src/__tests__/contextTranslation/vocabularyService.test.ts`
Expected: FAIL with missing compatibility layer.

- [ ] **Step 3: Implement persistence compatibility**

Rules:

- old saved translation entries remain readable
- new entries persist schema version, mode, locale tags, and annotation linkage
- do not require a one-shot destructive migration

- [ ] **Step 4: Run the tests to verify they pass**

Run: `corepack pnpm --filter @readest/readest-app test -- --run src/__tests__/contextTranslation/vocabularyCompatibility.test.ts src/__tests__/contextTranslation/vocabularyService.test.ts`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add apps/readest-app/src/services/contextTranslation/vocabularyCompatibility.ts apps/readest-app/src/services/contextTranslation/vocabularyService.ts apps/readest-app/src/services/contextTranslation/types.ts apps/readest-app/src/__tests__/contextTranslation/vocabularyCompatibility.test.ts apps/readest-app/src/__tests__/contextTranslation/vocabularyService.test.ts
git commit -m "feat: add context lookup persistence compatibility"
```

### Task 11: Add telemetry, failure handling, and final integration coverage

**Files:**
- Modify: `apps/readest-app/src/services/contextTranslation/contextLookupService.ts`
- Modify: `apps/readest-app/src/hooks/useContextLookup.ts`
- Test: `apps/readest-app/src/__tests__/contextTranslation/contextLookupTelemetry.test.ts`
- Test: `apps/readest-app/src/__tests__/contextTranslation/contextLookup.integration.test.ts`

- [ ] **Step 1: Write the failing tests**

```ts
test('records accept, repair, and degrade decisions for lookup results', async () => {
  await runContextLookup(request);
  expect(logLookupOutcome).toHaveBeenCalledWith(expect.objectContaining({ decision: expect.any(String) }));
});

test.each([
  ['en', 'zh-Hans'],
  ['zh-Hans', 'en'],
  ['ja', 'fr'],
  ['und', 'en'],
])('handles %s to %s representative lookups', async (sourceLanguage, targetLanguage) => {
  expect(await runScenario(sourceLanguage, targetLanguage)).toMatchObject({ ok: true });
});
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `corepack pnpm --filter @readest/readest-app test -- --run src/__tests__/contextTranslation/contextLookupTelemetry.test.ts src/__tests__/contextTranslation/contextLookup.integration.test.ts`
Expected: FAIL with missing telemetry and integration scaffolding.

- [ ] **Step 3: Implement telemetry and edge-case handling**

Rules:

- log decision state, repair count, degradation path, and plugin resolution
- cover `und`, low-confidence, mixed-language, short-string, and punctuation-heavy inputs
- keep kill-switch or feature-flag wiring explicit for staged rollout

- [ ] **Step 4: Run the tests to verify they pass**

Run: `corepack pnpm --filter @readest/readest-app test -- --run src/__tests__/contextTranslation/contextLookupTelemetry.test.ts src/__tests__/contextTranslation/contextLookup.integration.test.ts`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add apps/readest-app/src/services/contextTranslation/contextLookupService.ts apps/readest-app/src/hooks/useContextLookup.ts apps/readest-app/src/__tests__/contextTranslation/contextLookupTelemetry.test.ts apps/readest-app/src/__tests__/contextTranslation/contextLookup.integration.test.ts
git commit -m "feat: add context lookup telemetry and rollout guards"
```

### Final Verification Gate

- [ ] **Step 1: Run the focused context lookup suite**

Run: `corepack pnpm --filter @readest/readest-app test -- --run src/__tests__/contextTranslation/defaults.test.ts src/__tests__/contextTranslation/languagePolicy.test.ts src/__tests__/contextTranslation/normalizer.test.ts src/__tests__/contextTranslation/contextLookupService.test.ts src/__tests__/contextTranslation/pluginRegistry.test.ts src/__tests__/components/ContextTranslationPopup.test.tsx src/__tests__/components/ContextDictionaryPopup.test.tsx src/__tests__/components/Annotator.test.tsx`
Expected: PASS

- [ ] **Step 2: Run lint**

Run: `corepack pnpm --filter @readest/readest-app lint`
Expected: PASS

- [ ] **Step 3: Run typecheck or build if the workspace exposes one**

Run: `corepack pnpm --filter @readest/readest-app typecheck`
Fallback: `corepack pnpm --filter @readest/readest-app exec tsc --noEmit`
Expected: PASS

## Notes

- Do not promise full English syllable or stress annotation quality in v1; keep the `en` plugin deliberately minimal until a data source or robust heuristic is chosen.
- Keep the transport change repo-compatible by staying on text output and parsing sentinel-wrapped JSON only at the final response boundary.
- Preserve existing translation behavior behind compatibility adapters until the new shared pipeline has passing regression coverage.
- If a chunk exposes broader type fallout, stop and repair the shared types before taking the next chunk.

## Review Checklist

- [ ] `useContextLookup` is explicitly introduced before any task depends on it.
- [ ] Structured transport is defined concretely as `<lookup_json>...</lookup_json>` within text responses.
- [ ] Language detection and locale fallback route through `utils/lang.ts` and `languagePolicy.ts`.
- [ ] Translation popup tests no longer depend on `Chinese:` or other language-label parsing.
- [ ] The English plugin is scoped as minimal/no-op in v1.
- [ ] Annotation linkage and saved-vocabulary compatibility are covered by explicit tasks.
- [ ] Every chunk has a lint or typecheck gate before the next chunk begins.
