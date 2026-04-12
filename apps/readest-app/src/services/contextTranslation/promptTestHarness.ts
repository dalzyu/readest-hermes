/**
 * Prompt evaluation test harness for context translation.
 *
 * Runs a set of translation test cases against a configured AI model,
 * collects results (per-field output, latency, token count), and writes
 * them to a JSON file for comparison across prompt iterations and models.
 *
 * Usage (from workspace root):
 *   npx tsx apps/readest-app/scripts/run-prompt-eval.ts [--provider <id>] [--fixture <file>]
 */
import type { TranslationOutputField } from './types';
import { buildPerFieldPrompt, buildTranslationPrompt } from './promptBuilder';

// ─── Types ────────────────────────────────────────────────────────────────────

export interface PromptTestFixture {
  id: string;
  sourceText: string;
  sourceLanguage: string;
  targetLanguage: string;
  bookContext?: string;
  /** Optional expected field values for automated scoring. */
  expectedFields?: Record<string, string>;
}

export interface PromptTestResult {
  fixtureId: string;
  model: string;
  provider: string;
  fields: Record<string, string>;
  latencyMs: number;
  promptTokens?: number;
  completionTokens?: number;
  rawResponse: string;
  timestamp: number;
  scores?: Record<string, number>;
  attemptCount?: number;
}

export interface PromptEvalReport {
  runId: string;
  startedAt: number;
  completedAt: number;
  model: string;
  provider: string;
  results: PromptTestResult[];
  summary: {
    totalFixtures: number;
    succeeded: number;
    failed: number;
    averageLatencyMs: number;
  };
}

// ─── Default output fields for evaluation ─────────────────────────────────────

const EVAL_OUTPUT_FIELDS: TranslationOutputField[] = [
  { id: 'translation', label: 'Translation', enabled: true, order: 0, promptInstruction: 'Translate the selected text into the target language.' },
  { id: 'contextualMeaning', label: 'Contextual Meaning', enabled: true, order: 1, promptInstruction: 'Explain what the selected text means in this specific context.' },
  { id: 'phonetic', label: 'Phonetic', enabled: true, order: 2, promptInstruction: 'Provide the phonetic reading (pinyin/romaji/IPA as appropriate).' },
  { id: 'examples', label: 'Examples', enabled: true, order: 3, promptInstruction: 'Provide 2-3 example sentences using the selected text.' },
];

function parseTaggedFields(text: string, fields: TranslationOutputField[]): Record<string, string> {
  const parsed: Record<string, string> = {};
  for (const field of fields) {
    const regex = new RegExp(`<${field.id}>([\\s\\S]*?)</${field.id}>`, 'i');
    const match = regex.exec(text);
    if (match?.[1]) {
      parsed[field.id] = match[1].trim();
    }
  }
  return parsed;
}

function completionRatio(fields: Record<string, string>, schema: TranslationOutputField[]): number {
  const enabled = schema.filter((field) => field.enabled);
  if (enabled.length === 0) return 1;
  const present = enabled.filter((field) => Boolean(fields[field.id]?.trim())).length;
  return present / enabled.length;
}

function buildRepairPrompts(
  originalSystemPrompt: string,
  originalUserPrompt: string,
  fieldSchema: TranslationOutputField[],
): { systemPrompt: string; userPrompt: string } {
  const template = fieldSchema
    .filter((field) => field.enabled)
    .sort((a, b) => a.order - b.order)
    .map((field) => `<${field.id}>...</${field.id}>`)
    .join('\n');

  return {
    systemPrompt: `${originalSystemPrompt}\n\nThe previous answer was malformed or incomplete. Retry now with strict XML only:\n${template}\nNo markdown. No reasoning. No extra text.`,
    userPrompt: `Retry the original request and return only the requested tags in the required order.\n\nOriginal request:\n${originalUserPrompt}`,
  };
}

function scoreResult(
  fixture: PromptTestFixture,
  fields: Record<string, string>,
  rawResponse: string,
): Record<string, number> {
  const scores: Record<string, number> = {};

  const hasTranslation = Boolean(fields['translation']?.trim());
  scores['translationPresent'] = hasTranslation ? 1 : 0;
  scores['xmlCoverage'] = completionRatio(fields, EVAL_OUTPUT_FIELDS);
  scores['noReasoningLeak'] = /<(translation|contextualMeaning|phonetic|examples)>/i.test(rawResponse)
    ? 1
    : 0;

  if (fixture.expectedFields) {
    for (const [key, expected] of Object.entries(fixture.expectedFields)) {
      const actual = fields[key] ?? '';
      scores[`expected_${key}`] = actual.toLowerCase().includes(expected.toLowerCase()) ? 1 : 0;
    }
  }

  // Composite usability: prioritize non-empty translation and XML structure compliance.
  const expectedScores = Object.entries(scores)
    .filter(([key]) => key.startsWith('expected_'))
    .map(([, value]) => value);
  const expectedMean =
    expectedScores.length > 0
      ? expectedScores.reduce((sum, value) => sum + value, 0) / expectedScores.length
      : 1;
  const usability = scores['translationPresent'] * 0.45 + scores['xmlCoverage'] * 0.35 + expectedMean * 0.2;
  scores['usability'] = Number(usability.toFixed(3));

  return scores;
}

// ─── Runner ───────────────────────────────────────────────────────────────────

export async function runPromptEval(
  fixtures: PromptTestFixture[],
  callModel: (
    systemPrompt: string,
    userPrompt: string,
    label?: string,
  ) => Promise<{
    text: string;
    promptTokens?: number;
    completionTokens?: number;
  }>,
  meta: { model: string; provider: string },
): Promise<PromptEvalReport> {
  const runId = `eval-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
  const startedAt = Date.now();
  const results: PromptTestResult[] = [];

  for (const fixture of fixtures) {
    const { systemPrompt, userPrompt } = buildTranslationPrompt({
      selectedText: fixture.sourceText,
      popupContext: {
        localPastContext: fixture.bookContext ?? '',
        localFutureBuffer: '',
        sameBookChunks: [],
        priorVolumeChunks: [],
        dictionaryEntries: [],
        retrievalStatus: 'local-only',
        retrievalHints: {
          currentVolumeIndexed: false,
          missingLocalIndex: false,
          missingPriorVolumes: [],
          missingSeriesAssignment: false,
        },
      },
      sourceLanguage: fixture.sourceLanguage,
      targetLanguage: fixture.targetLanguage,
      outputFields: EVAL_OUTPUT_FIELDS,
    });

    const t0 = performance.now();
    try {
      let attemptCount = 1;
      let response = await callModel(systemPrompt, userPrompt, 'initial');
      let parsedFields = parseTaggedFields(response.text, EVAL_OUTPUT_FIELDS);

      if (!parsedFields['translation'] || completionRatio(parsedFields, EVAL_OUTPUT_FIELDS) < 0.5) {
        attemptCount += 1;
        const repair = buildRepairPrompts(systemPrompt, userPrompt, EVAL_OUTPUT_FIELDS);
        response = await callModel(repair.systemPrompt, repair.userPrompt, 'repair');
        parsedFields = parseTaggedFields(response.text, EVAL_OUTPUT_FIELDS);
      }

      if (!parsedFields['translation']) {
        attemptCount += 1;
        // Final rescue: call per-field prompts and stitch a minimal usable record.
        const stitched: Record<string, string> = {};
        for (const field of EVAL_OUTPUT_FIELDS.filter((f) => f.enabled)) {
          const perField = buildPerFieldPrompt(field, {
            selectedText: fixture.sourceText,
            popupContext: {
              localPastContext: fixture.bookContext ?? '',
              localFutureBuffer: '',
              sameBookChunks: [],
              priorVolumeChunks: [],
              dictionaryEntries: [],
              retrievalStatus: 'local-only',
              retrievalHints: {
                currentVolumeIndexed: false,
                missingLocalIndex: false,
                missingPriorVolumes: [],
                missingSeriesAssignment: false,
              },
            },
            sourceLanguage: fixture.sourceLanguage,
            targetLanguage: fixture.targetLanguage,
            outputFields: EVAL_OUTPUT_FIELDS,
          });
          const fieldOnly = await callModel(perField.systemPrompt, perField.userPrompt, `field:${field.id}`);
          stitched[field.id] = fieldOnly.text.trim();
        }

        const stitchedRaw = EVAL_OUTPUT_FIELDS.filter((f) => f.enabled)
          .map((f) => `<${f.id}>${stitched[f.id] ?? ''}</${f.id}>`)
          .join('\n');
        response = {
          text: stitchedRaw,
          promptTokens: response.promptTokens,
          completionTokens: response.completionTokens,
        };
        parsedFields = stitched;
      }

      const latencyMs = Math.round(performance.now() - t0);
      const scores = scoreResult(fixture, parsedFields, response.text);

      results.push({
        fixtureId: fixture.id,
        model: meta.model,
        provider: meta.provider,
        fields: parsedFields,
        latencyMs,
        promptTokens: response.promptTokens,
        completionTokens: response.completionTokens,
        rawResponse: response.text,
        timestamp: Date.now(),
        scores,
        attemptCount,
      });
    } catch (err) {
      results.push({
        fixtureId: fixture.id,
        model: meta.model,
        provider: meta.provider,
        fields: {},
        latencyMs: Math.round(performance.now() - t0),
        rawResponse: `ERROR: ${err instanceof Error ? err.message : String(err)}`,
        timestamp: Date.now(),
      });
    }
  }

  const completedAt = Date.now();
  const succeeded = results.filter((r) => Object.keys(r.fields).length > 0).length;
  const avgLatency =
    results.length > 0
      ? Math.round(results.reduce((sum, r) => sum + r.latencyMs, 0) / results.length)
      : 0;

  return {
    runId,
    startedAt,
    completedAt,
    model: meta.model,
    provider: meta.provider,
    results,
    summary: {
      totalFixtures: fixtures.length,
      succeeded,
      failed: fixtures.length - succeeded,
      averageLatencyMs: avgLatency,
    },
  };
}
