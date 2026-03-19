# Context Translation Streaming Implementation Plan

> **For agentic workers:** REQUIRED: Use superpowers:subagent-driven-development (if subagents available) or superpowers:executing-plans to implement this plan. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Stream partial context-translation results into the existing popup field cards while tightening Chinese example output to require Chinese, pinyin, and English formatting.

**Architecture:** Keep the existing field-card popup and move the context-translation flow from single-shot generation to structured streaming. Add an incremental XML field parser, parallelize context gathering in the hook, and update the popup to render stable ordered cards with live typing state. Tighten prompt instructions so the model emits ordered tags and Chinese examples in a fixed bilingual format.

**Tech Stack:** React 19, TypeScript, Vercel AI SDK (`streamText`), Vitest, existing context-translation services/hooks.

---

## File Structure

- Modify: `apps/readest-app/src/services/contextTranslation/types.ts`
  - Extend streaming-related types so the service and hook can expose partial field state.
- Modify: `apps/readest-app/src/services/contextTranslation/promptBuilder.ts`
  - Enforce ordered XML output and Chinese example formatting.
- Modify: `apps/readest-app/src/services/contextTranslation/responseParser.ts`
  - Add incremental parsing support for partial tagged output.
- Modify: `apps/readest-app/src/services/contextTranslation/llmClient.ts`
  - Add a streaming wrapper around the AI SDK model call.
- Modify: `apps/readest-app/src/services/contextTranslation/translationService.ts`
  - Expose a streaming translation API that yields structured field updates.
- Modify: `apps/readest-app/src/hooks/useContextTranslation.ts`
  - Parallelize context loading and consume the streaming translation service.
- Modify: `apps/readest-app/src/app/reader/components/annotator/ContextTranslationPopup.tsx`
  - Render stable ordered cards with live typing state and delayed save enablement.
- Modify: `apps/readest-app/src/__tests__/contextTranslation/promptBuilder.test.ts`
  - Cover ordered tags and Chinese examples contract.
- Modify: `apps/readest-app/src/__tests__/contextTranslation/responseParser.test.ts`
  - Cover incremental parsing of partial tagged output.
- Modify: `apps/readest-app/src/__tests__/contextTranslation/translationService.test.ts`
  - Cover streamed partial field updates.
- Modify: `apps/readest-app/src/__tests__/contextTranslation/useContextTranslation.test.ts`
  - Cover parallel context fetch and progressive hook updates.

## Chunk 1: Prompt And Parser Contract

### Task 1: Add failing tests for ordered tags and Chinese examples

**Files:**
- Modify: `apps/readest-app/src/__tests__/contextTranslation/promptBuilder.test.ts`

- [ ] **Step 1: Write the failing tests**

```ts
test('requires enabled fields to be emitted in configured order', () => {
  const { systemPrompt } = buildTranslationPrompt({
    ...baseRequest,
    sourceLanguage: 'zh',
  });

  expect(systemPrompt).toContain('Emit fields in this exact order');
  expect(systemPrompt.indexOf('<translation>')).toBeLessThan(
    systemPrompt.indexOf('<contextualMeaning>'),
  );
});

test('requires chinese examples to include chinese pinyin and english', () => {
  const { systemPrompt } = buildTranslationPrompt({
    ...baseRequest,
    sourceLanguage: 'zh',
    outputFields: [
      ...baseFields.slice(0, 2),
      { ...baseFields[2]!, enabled: true },
    ],
  });

  expect(systemPrompt).toContain('Pinyin:');
  expect(systemPrompt).toContain('English:');
  expect(systemPrompt).toContain('1. 中文句子');
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `corepack pnpm test -- --watch=false src/__tests__/contextTranslation/promptBuilder.test.ts`
Expected: FAIL because the current prompt does not mention exact field order or Chinese example formatting.

- [ ] **Step 3: Write minimal implementation**

Update `buildTranslationPrompt()` in `apps/readest-app/src/services/contextTranslation/promptBuilder.ts` to:

```ts
const orderedFieldIds = enabledFields.map((field) => field.id).join(', ');

const chineseExamplesInstruction =
  request.sourceLanguage === 'zh' || /[\u3400-\u9fff]/.test(request.selectedText)
    ? `
If <examples> is requested, each example must use this exact layout:
1. 中文句子
Pinyin: ...
English: ...

2. 中文句子
Pinyin: ...
English: ...
`
    : '';

const systemPrompt = `...
Emit fields in this exact order: ${orderedFieldIds}.
Do not emit any text outside the requested tags.
${chineseExamplesInstruction}`;
```

- [ ] **Step 4: Run test to verify it passes**

Run: `corepack pnpm test -- --watch=false src/__tests__/contextTranslation/promptBuilder.test.ts`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add apps/readest-app/src/services/contextTranslation/promptBuilder.ts apps/readest-app/src/__tests__/contextTranslation/promptBuilder.test.ts
git commit -m "test: tighten context translation prompt contract"
```

### Task 2: Add failing tests for incremental XML parsing

**Files:**
- Modify: `apps/readest-app/src/__tests__/contextTranslation/responseParser.test.ts`
- Modify: `apps/readest-app/src/services/contextTranslation/responseParser.ts`

- [ ] **Step 1: Write the failing tests**

```ts
test('parses partial content for the active field while streaming', () => {
  const result = parseStreamingTranslationResponse(
    '<translation>close fr',
    fields,
  );

  expect(result.fields.translation).toBe('close fr');
  expect(result.activeFieldId).toBe('translation');
});

test('keeps field order and accumulates later completed tags', () => {
  const result = parseStreamingTranslationResponse(
    '<translation>close friend</translation><contextualMeaning>a trusted companion',
    fields,
  );

  expect(result.fields.translation).toBe('close friend');
  expect(result.fields.contextualMeaning).toBe('a trusted companion');
  expect(result.activeFieldId).toBe('contextualMeaning');
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `corepack pnpm test -- --watch=false src/__tests__/contextTranslation/responseParser.test.ts`
Expected: FAIL because the current parser only supports fully completed tagged responses.

- [ ] **Step 3: Write minimal implementation**

Add a streaming parser in `apps/readest-app/src/services/contextTranslation/responseParser.ts`:

```ts
export interface StreamingParseResult {
  fields: TranslationResult;
  activeFieldId: string | null;
}

export function parseStreamingTranslationResponse(
  response: string,
  fields: TranslationOutputField[],
): StreamingParseResult {
  const enabledFields = fields.filter((field) => field.enabled).sort((a, b) => a.order - b.order);
  const parsed: TranslationResult = {};
  let activeFieldId: string | null = null;

  for (const field of enabledFields) {
    const startTag = `<${field.id}>`;
    const endTag = `</${field.id}>`;
    const startIndex = response.indexOf(startTag);
    if (startIndex === -1) continue;

    const contentStart = startIndex + startTag.length;
    const endIndex = response.indexOf(endTag, contentStart);
    const content =
      endIndex === -1
        ? response.slice(contentStart)
        : response.slice(contentStart, endIndex);

    parsed[field.id] = content.trim();
    if (endIndex === -1) activeFieldId = field.id;
  }

  return { fields: parsed, activeFieldId };
}
```

Keep `parseTranslationResponse()` as the final-response parser, and reuse the streaming parser where it reduces duplication.

- [ ] **Step 4: Run test to verify it passes**

Run: `corepack pnpm test -- --watch=false src/__tests__/contextTranslation/responseParser.test.ts`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add apps/readest-app/src/services/contextTranslation/responseParser.ts apps/readest-app/src/__tests__/contextTranslation/responseParser.test.ts
git commit -m "test: add streaming parser for context translation"
```

## Chunk 2: Streaming Service And Hook

### Task 3: Add failing tests for streaming translation service

**Files:**
- Modify: `apps/readest-app/src/__tests__/contextTranslation/translationService.test.ts`
- Modify: `apps/readest-app/src/services/contextTranslation/llmClient.ts`
- Modify: `apps/readest-app/src/services/contextTranslation/translationService.ts`

- [ ] **Step 1: Write the failing tests**

```ts
test('streams partial field updates in order', async () => {
  mockStreamLLM.mockImplementation(async function* () {
    yield '<translation>close';
    yield ' friend</translation><contextualMeaning>trusted ally';
    yield '</contextualMeaning>';
  });

  const updates: TranslationStreamState[] = [];

  for await (const update of streamTranslationWithContext({
    selectedText: '知己',
    recentContext: 'He found a true 知己.',
    targetLanguage: 'en',
    outputFields: fields,
  })) {
    updates.push(update);
  }

  expect(updates[0]!.fields.translation).toBe('close');
  expect(updates[1]!.fields.translation).toBe('close friend');
  expect(updates[1]!.fields.contextualMeaning).toBe('trusted ally');
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `corepack pnpm test -- --watch=false src/__tests__/contextTranslation/translationService.test.ts`
Expected: FAIL because only the single-shot `translateWithContext()` flow exists.

- [ ] **Step 3: Write minimal implementation**

In `apps/readest-app/src/services/contextTranslation/llmClient.ts`, add:

```ts
import { generateText, streamText } from 'ai';

export async function* streamLLM(
  systemPrompt: string,
  userPrompt: string,
  model: LanguageModel,
): AsyncGenerator<string> {
  const result = streamText({
    model,
    system: systemPrompt,
    prompt: userPrompt,
  });

  for await (const chunk of result.textStream) {
    yield chunk;
  }
}
```

In `apps/readest-app/src/services/contextTranslation/translationService.ts`, add:

```ts
export interface TranslationStreamState {
  fields: TranslationResult;
  activeFieldId: string | null;
  rawText: string;
  done: boolean;
}

export async function* streamTranslationWithContext(
  request: TranslationRequest,
  model: LanguageModel,
): AsyncGenerator<TranslationStreamState> {
  const { systemPrompt, userPrompt } = buildTranslationPrompt(request);
  let rawText = '';

  for await (const chunk of streamLLM(systemPrompt, userPrompt, model)) {
    rawText += chunk;
    const parsed = parseStreamingTranslationResponse(rawText, request.outputFields);
    yield {
      fields: parsed.fields,
      activeFieldId: parsed.activeFieldId,
      rawText,
      done: false,
    };
  }

  yield {
    fields: parseTranslationResponse(rawText, request.outputFields),
    activeFieldId: null,
    rawText,
    done: true,
  };
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `corepack pnpm test -- --watch=false src/__tests__/contextTranslation/translationService.test.ts`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add apps/readest-app/src/services/contextTranslation/llmClient.ts apps/readest-app/src/services/contextTranslation/translationService.ts apps/readest-app/src/__tests__/contextTranslation/translationService.test.ts
git commit -m "feat: stream context translation fields"
```

### Task 4: Add failing tests for parallel context gathering and partial hook updates

**Files:**
- Modify: `apps/readest-app/src/__tests__/contextTranslation/useContextTranslation.test.ts`
- Modify: `apps/readest-app/src/hooks/useContextTranslation.ts`
- Modify: `apps/readest-app/src/services/contextTranslation/types.ts`

- [ ] **Step 1: Write the failing tests**

```ts
test('starts recent context and rag loading in parallel', async () => {
  let recentStarted = false;
  let ragStarted = false;

  vi.mocked(getRecentPageContext).mockImplementation(async () => {
    recentStarted = true;
    expect(ragStarted).toBe(true);
    return 'recent';
  });

  vi.mocked(getCrossVolumeContext).mockImplementation(async () => {
    ragStarted = true;
    expect(recentStarted).toBe(true);
    return 'rag';
  });

  renderHook(() => useContextTranslation(defaultProps));

  await waitFor(() => expect(streamTranslationWithContext).toHaveBeenCalled());
});

test('publishes partial result updates while streaming', async () => {
  vi.mocked(streamTranslationWithContext).mockImplementation(async function* () {
    yield { fields: { translation: 'close' }, activeFieldId: 'translation', rawText: '<translation>close', done: false };
    yield { fields: { translation: 'close friend' }, activeFieldId: null, rawText: '<translation>close friend</translation>', done: true };
  });

  const { result } = renderHook(() => useContextTranslation(defaultProps));

  await waitFor(() => expect(result.current.partialResult?.translation).toBe('close'));
  await waitFor(() => expect(result.current.result?.translation).toBe('close friend'));
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `corepack pnpm test -- --watch=false src/__tests__/contextTranslation/useContextTranslation.test.ts`
Expected: FAIL because the hook currently waits on sequential context calls and only exposes a final result.

- [ ] **Step 3: Write minimal implementation**

In `apps/readest-app/src/services/contextTranslation/types.ts`, add streaming-related interfaces if shared:

```ts
export interface TranslationStreamResult {
  fields: TranslationResult;
  activeFieldId: string | null;
  rawText: string;
  done: boolean;
}
```

In `apps/readest-app/src/hooks/useContextTranslation.ts`:

```ts
const [partialResult, setPartialResult] = useState<TranslationResult | null>(null);
const [streaming, setStreaming] = useState(false);
const [activeFieldId, setActiveFieldId] = useState<string | null>(null);

const [recentContext, ragContext] = await Promise.all([
  getRecentPageContext(bookHash, currentPage, settings.recentContextPages),
  getCrossVolumeContext(bookHash, selectedText, 3),
]);

for await (const update of streamTranslationWithContext(request, model)) {
  if (cancelled) return;
  setPartialResult(update.fields);
  setActiveFieldId(update.activeFieldId);
  setStreaming(!update.done);

  if (update.done) {
    setResult(update.fields);
  }
}
```

Expose `partialResult`, `streaming`, and `activeFieldId` from the hook, and keep `saveToVocabulary()` based on final `result`.

- [ ] **Step 4: Run test to verify it passes**

Run: `corepack pnpm test -- --watch=false src/__tests__/contextTranslation/useContextTranslation.test.ts`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add apps/readest-app/src/services/contextTranslation/types.ts apps/readest-app/src/hooks/useContextTranslation.ts apps/readest-app/src/__tests__/contextTranslation/useContextTranslation.test.ts
git commit -m "feat: stream context translation state through hook"
```

## Chunk 3: Popup Rendering And Verification

### Task 5: Add failing tests for ordered live card rendering

**Files:**
- Modify: `apps/readest-app/src/app/reader/components/annotator/ContextTranslationPopup.tsx`
- Create or modify a popup-focused test file if one exists; otherwise extend `apps/readest-app/src/__tests__/contextTranslation/useContextTranslation.test.ts`

- [ ] **Step 1: Write the failing tests**

Use the existing React test setup to verify:

```ts
test('renders cards in configured order with partial streamed values', () => {
  mockUseContextTranslation.mockReturnValue({
    result: null,
    partialResult: {
      translation: 'close friend',
      contextualMeaning: 'trusted companion',
    },
    streaming: true,
    activeFieldId: 'contextualMeaning',
    loading: false,
    error: null,
    saveToVocabulary: vi.fn(),
  });

  render(<ContextTranslationPopup ... />);

  const headings = screen.getAllByRole('heading', { level: 3 }).map((el) => el.textContent);
  expect(headings).toEqual(['Translation', 'Contextual Meaning', 'Usage Examples']);
  expect(screen.getByText('trusted companion')).toBeInTheDocument();
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `corepack pnpm test -- --watch=false src/__tests__/contextTranslation/useContextTranslation.test.ts`
Expected: FAIL because the popup only renders completed `result` values and does not show live card state.

- [ ] **Step 3: Write minimal implementation**

In `apps/readest-app/src/app/reader/components/annotator/ContextTranslationPopup.tsx`:

```tsx
const displayedResult = result ?? partialResult ?? {};

{enabledFields.map((field) => {
  const value = displayedResult[field.id] ?? '';
  const isActive = streaming && activeFieldId === field.id;

  return (
    <div key={field.id}>
      <h3 ...>{_(field.label)}</h3>
      <p ...>
        {value || (streaming ? _('Waiting...') : '')}
        {isActive ? <span className='ml-1 animate-pulse'>|</span> : null}
      </p>
    </div>
  );
})}

<button disabled={!result || streaming || saved} ... />
```

Keep card order based on configured `order`, not generation timing.

- [ ] **Step 4: Run test to verify it passes**

Run: `corepack pnpm test -- --watch=false src/__tests__/contextTranslation/useContextTranslation.test.ts`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add apps/readest-app/src/app/reader/components/annotator/ContextTranslationPopup.tsx apps/readest-app/src/__tests__/contextTranslation/useContextTranslation.test.ts
git commit -m "feat: stream context translation into popup cards"
```

### Task 6: Run focused verification

**Files:**
- No code changes expected

- [ ] **Step 1: Run focused context-translation tests**

Run:

```bash
corepack pnpm test -- --watch=false src/__tests__/contextTranslation/promptBuilder.test.ts src/__tests__/contextTranslation/responseParser.test.ts src/__tests__/contextTranslation/translationService.test.ts src/__tests__/contextTranslation/useContextTranslation.test.ts
```

Expected: PASS with all focused context-translation tests green.

- [ ] **Step 2: Run adjacent AI tests for regression confidence**

Run:

```bash
corepack pnpm test -- --watch=false src/__tests__/ai/chunker.test.ts src/__tests__/ai/providers.test.ts src/__tests__/ai/retry.test.ts src/__tests__/ai/ragService.test.ts
```

Expected: PASS

- [ ] **Step 3: Manual smoke check**

Manually verify in the reader:

- open a Chinese book
- trigger context-aware translation on Chinese text
- confirm `Translation` starts filling first
- confirm `Contextual Meaning` and `Usage Examples` appear in stable order
- confirm Chinese examples include:
  - Chinese sentence
  - `Pinyin:` line
  - `English:` line
- confirm save-to-vocabulary only enables after the stream completes

- [ ] **Step 4: Commit**

```bash
git add .
git commit -m "feat: stream context-aware translation popup"
```

