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
import { buildTranslationPrompt } from './promptBuilder';

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

// ─── Runner ───────────────────────────────────────────────────────────────────

export async function runPromptEval(
  fixtures: PromptTestFixture[],
  callModel: (systemPrompt: string, userPrompt: string) => Promise<{
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
      const response = await callModel(systemPrompt, userPrompt);
      const latencyMs = Math.round(performance.now() - t0);

      // Parse XML-tagged fields from response
      const fields: Record<string, string> = {};
      for (const field of EVAL_OUTPUT_FIELDS) {
        const regex = new RegExp(`<${field.id}>([\\s\\S]*?)</${field.id}>`, 'i');
        const match = regex.exec(response.text);
        if (match?.[1]) {
          fields[field.id] = match[1].trim();
        }
      }

      // Simple exact-match scoring against expected fields
      const scores: Record<string, number> = {};
      if (fixture.expectedFields) {
        for (const [key, expected] of Object.entries(fixture.expectedFields)) {
          const actual = fields[key] ?? '';
          scores[key] = actual.toLowerCase().includes(expected.toLowerCase()) ? 1 : 0;
        }
      }

      results.push({
        fixtureId: fixture.id,
        model: meta.model,
        provider: meta.provider,
        fields,
        latencyMs,
        promptTokens: response.promptTokens,
        completionTokens: response.completionTokens,
        rawResponse: response.text,
        timestamp: Date.now(),
        scores: Object.keys(scores).length > 0 ? scores : undefined,
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
