#!/usr/bin/env tsx
import { existsSync, readFileSync, unlinkSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { parseArgs } from 'node:util';
import { JUDGE_MODEL_ID, mapWithConcurrency, retryWithBackoff } from './evalHarnessUtils';

interface TranslationResult {
  fixtureId: string;
  model: string;
  fields: Record<string, string>;
  latencyMs: number;
  rawResponse: string;
  scores?: Record<string, number>;
  attemptCount?: number;
}

interface EvalReport {
  runId: string;
  model: string;
  results: TranslationResult[];
  summary: Record<string, unknown>;
}

interface JudgeScore {
  fixtureId: string;
  translationModel: string;
  accuracy: number;
  fluency: number;
  contextPreservation: number;
  rationale: string;
  judgeModel: string;
  timestamp: number;
}

interface JudgeCheckpoint {
  judgeModel: string;
  translationModel: string;
  completedFixtureIds: string[];
  scores: JudgeScore[];
}

type FixtureRecord = {
  id: string;
  sourceText: string;
  sourceLanguage: string;
  targetLanguage: string;
  bookContext: string;
};

type ChatResponse = {
  choices?: Array<{ message?: { content?: string } }>;
};

const JUDGE_SYSTEM_PROMPT = `You are an expert multilingual translation quality evaluator. Score translations on three dimensions:

1. accuracy (1-5): How accurately does the translation convey the meaning of the source text in context?
2. fluency (1-5): How natural and grammatically correct is the translation in the target language?
3. context_preservation (1-5): How well does the translation preserve the literary context and nuance?

Score 1 = terrible/wrong, 2 = poor, 3 = acceptable, 4 = good, 5 = excellent.

Respond ONLY with this exact JSON format (no other text):
{"accuracy": N, "fluency": N, "context_preservation": N, "rationale": "one-line explanation"}`;

const REQUEST_TIMEOUT_MS = 90_000;
const RETRY_DELAYS_MS = [1_000, 3_000, 7_000];

function isRetryableRequestError(error: unknown): boolean {
  const message =
    error instanceof Error ? error.message.toLowerCase() : String(error).toLowerCase();
  return (
    message.includes('fetch failed') ||
    message.includes('proxy error') ||
    message.includes('timed out') ||
    message.includes('timeout') ||
    message.includes('ecconnrefused') ||
    message.includes('socket hang up') ||
    message.includes('terminated') ||
    message.includes('(500)')
  );
}

async function requestJson(url: string, init: RequestInit): Promise<unknown> {
  return retryWithBackoff(
    async () => {
      const response = await fetch(url, {
        ...init,
        signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
      });
      if (!response.ok) {
        const body = await response.text();
        throw new Error(`${init.method ?? 'GET'} ${url} failed (${response.status}) :: ${body}`);
      }
      return response.json();
    },
    {
      retries: RETRY_DELAYS_MS.length,
      delaysMs: RETRY_DELAYS_MS,
      shouldRetry: isRetryableRequestError,
    },
  );
}

async function postLifecycle(baseUrl: string, path: string, model: string): Promise<void> {
  const response = await fetch(`${baseUrl}${path}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ model }),
  });

  if (response.ok) {
    return;
  }

  const body = await response.text();
  const normalized = body.toLowerCase();
  const acceptable =
    response.status === 400 &&
    (normalized.includes('already running') ||
      normalized.includes('not running') ||
      normalized.includes('already loaded') ||
      normalized.includes('not loaded'));

  if (acceptable) {
    return;
  }

  throw new Error(`POST ${baseUrl}${path} failed (${response.status}) :: ${body}`);
}

async function loadModel(baseUrl: string, model: string): Promise<void> {
  try {
    await postLifecycle(baseUrl, '/models/load', model);
  } catch {
    await postLifecycle(baseUrl, '/v1/models/load', model);
  }
}

async function unloadModel(baseUrl: string, model: string): Promise<void> {
  try {
    await postLifecycle(baseUrl, '/models/unload', model);
  } catch {
    await postLifecycle(baseUrl, '/v1/models/unload', model);
  }
}

async function listModels(baseUrl: string): Promise<Array<{ id: string }>> {
  const payload = (await requestJson(`${baseUrl}/v1/models`, {
    method: 'GET',
    headers: { 'Content-Type': 'application/json' },
  })) as { data?: Array<{ id: string }> };
  return payload.data ?? [];
}

async function callJudge(
  baseUrl: string,
  model: string,
  systemPrompt: string,
  userPrompt: string,
): Promise<string> {
  const payload = (await requestJson(`${baseUrl}/v1/chat/completions`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      model,
      messages: [
        { role: 'system', content: systemPrompt },
        { role: 'user', content: userPrompt },
      ],
    }),
  })) as ChatResponse;

  return payload.choices?.[0]?.message?.content ?? '';
}

function buildJudgeUserPrompt(
  sourceText: string,
  sourceLanguage: string,
  targetLanguage: string,
  bookContext: string,
  translation: string,
): string {
  return `Source language: ${sourceLanguage}
Target language: ${targetLanguage}
Source text: "${sourceText}"
Book context: "${bookContext}"
Translation produced: "${translation}"

Score the translation quality.`;
}

function parseJudgeResponse(
  text: string,
): { accuracy: number; fluency: number; contextPreservation: number; rationale: string } | null {
  try {
    const jsonMatch = text.match(/\{[\s\S]*?\}/);
    if (!jsonMatch) {
      return null;
    }

    const parsed = JSON.parse(jsonMatch[0]);
    const accuracy = Number(parsed.accuracy);
    const fluency = Number(parsed.fluency);
    const contextPreservation = Number(parsed.context_preservation);
    const rationale = String(parsed.rationale ?? '');

    if (
      [accuracy, fluency, contextPreservation].some(
        (value) => Number.isNaN(value) || value < 1 || value > 5,
      )
    ) {
      return null;
    }

    return { accuracy, fluency, contextPreservation, rationale };
  } catch {
    return null;
  }
}

function formatProgress(current: number, total: number, startTime: number): string {
  const pct = ((current / total) * 100).toFixed(1);
  const elapsed = Date.now() - startTime;
  const msPerItem = elapsed / Math.max(current, 1);
  const remaining = msPerItem * (total - current);
  const etaMin = Math.ceil(remaining / 60000);
  const etaStr = etaMin > 60 ? `${Math.floor(etaMin / 60)}h${etaMin % 60}m` : `${etaMin}m`;
  return `${current}/${total} (${pct}%) - ETA ${etaStr}`;
}

function saveCheckpoint(path: string, data: JudgeCheckpoint): void {
  writeFileSync(path, JSON.stringify(data, null, 2));
}

async function judgeResult(params: {
  endpoint: string;
  judgeModelId: string;
  translationModel: string;
  result: TranslationResult;
  fixtureMap: Map<string, FixtureRecord>;
}): Promise<JudgeScore> {
  const { endpoint, judgeModelId, translationModel, result, fixtureMap } = params;
  const fixture = fixtureMap.get(result.fixtureId);
  const translation = result.fields?.['translation'] ?? '';

  if (!fixture || !translation.trim()) {
    return {
      fixtureId: result.fixtureId,
      translationModel,
      accuracy: 0,
      fluency: 0,
      contextPreservation: 0,
      rationale: translation.trim() ? 'unknown fixture' : 'empty translation',
      judgeModel: judgeModelId,
      timestamp: Date.now(),
    };
  }

  const userPrompt = buildJudgeUserPrompt(
    fixture.sourceText,
    fixture.sourceLanguage,
    fixture.targetLanguage,
    fixture.bookContext,
    translation,
  );

  let judgeResult: ReturnType<typeof parseJudgeResponse> = null;
  for (let attempt = 0; attempt < 2; attempt += 1) {
    try {
      const response = await callJudge(endpoint, judgeModelId, JUDGE_SYSTEM_PROMPT, userPrompt);
      judgeResult = parseJudgeResponse(response);
      if (judgeResult) {
        break;
      }
    } catch (error) {
      console.error(`Error judging ${result.fixtureId}: ${error}`);
    }
  }

  return {
    fixtureId: result.fixtureId,
    translationModel,
    accuracy: judgeResult?.accuracy ?? 0,
    fluency: judgeResult?.fluency ?? 0,
    contextPreservation: judgeResult?.contextPreservation ?? 0,
    rationale: judgeResult?.rationale ?? 'judge parse failure',
    judgeModel: judgeModelId,
    timestamp: Date.now(),
  };
}

async function main() {
  const { values } = parseArgs({
    options: {
      endpoint: { type: 'string', default: 'http://127.0.0.1:8081' },
      input: { type: 'string' },
      'judge-model': { type: 'string', default: JUDGE_MODEL_ID },
      output: { type: 'string' },
      'fixture-file': { type: 'string', default: 'scripts/eval/mini-weak-clusters-fixtures.json' },
      checkpoint: { type: 'boolean', default: true },
      concurrency: { type: 'string', default: '1' },
    },
  });

  if (!values.input) {
    console.error('Usage: --input <eval-results.json> [--judge-model <model>] [--output <file>]');
    process.exit(1);
  }

  const endpoint = String(values.endpoint ?? 'http://127.0.0.1:8081').replace(/\/$/, '');
  const inputPath = resolve(String(values.input));
  const judgeModelId = String(values['judge-model'] ?? JUDGE_MODEL_ID);
  const outputPath = resolve(
    String(values.output ?? `scripts/eval/quality-scores-${Date.now()}.json`),
  );
  const fixturePath = resolve(
    String(values['fixture-file'] ?? 'scripts/eval/mini-weak-clusters-fixtures.json'),
  );
  const useCheckpoint = Boolean(values.checkpoint);
  const concurrency = Math.max(1, Number(values.concurrency ?? '1'));

  const evalData = JSON.parse(readFileSync(inputPath, 'utf8'));
  const reports: Record<string, EvalReport> = evalData.reports ?? {};
  const fixtures: Array<{
    id: string;
    sourceText: string;
    sourceLanguage: string;
    targetLanguage: string;
    bookContext: string;
  }> = JSON.parse(readFileSync(fixturePath, 'utf8'));
  const fixtureMap = new Map(fixtures.map((fixture) => [fixture.id, fixture]));

  console.log(`Loading judge model: ${judgeModelId}`);
  const available = await listModels(endpoint);
  if (!available.some((model) => model.id === judgeModelId)) {
    throw new Error(`Judge model not found on endpoint inventory: ${judgeModelId}`);
  }

  for (const model of available) {
    try {
      await unloadModel(endpoint, model.id);
    } catch {
      // Ignore unload failures.
    }
  }
  await loadModel(endpoint, judgeModelId);
  console.log('Judge model loaded.');

  const allScores: Record<string, JudgeScore[]> = {};

  for (const [translationModel, report] of Object.entries(reports)) {
    console.log(`\n${'='.repeat(60)}`);
    console.log(`Judging: ${translationModel} (${report.results.length} results)`);
    console.log(`${'='.repeat(60)}`);

    const checkpointPath = outputPath.replace(
      /\.json$/,
      `.checkpoint-${translationModel.replace(/[/\\:]/g, '_')}.json`,
    );
    const scores: JudgeScore[] = [];
    let completedSet = new Set<string>();

    if (useCheckpoint && existsSync(checkpointPath)) {
      try {
        const checkpoint = JSON.parse(readFileSync(checkpointPath, 'utf8')) as JudgeCheckpoint;
        if (
          checkpoint.translationModel === translationModel &&
          checkpoint.judgeModel === judgeModelId
        ) {
          completedSet = new Set(checkpoint.completedFixtureIds);
          scores.push(...checkpoint.scores);
          console.log(`Resumed: ${completedSet.size} already judged`);
        }
      } catch {
        // Ignore invalid checkpoint files.
      }
    }

    const remaining = report.results.filter((result) => !completedSet.has(result.fixtureId));
    const total = report.results.length;
    let processed = scores.length;
    const startTime = Date.now();

    const batchSize = Math.max(1, concurrency * 5);
    for (let offset = 0; offset < remaining.length; offset += batchSize) {
      const batch = remaining.slice(offset, offset + batchSize);
      const batchScores = await mapWithConcurrency(batch, concurrency, async (result) =>
        judgeResult({
          endpoint,
          judgeModelId,
          translationModel,
          result,
          fixtureMap,
        }),
      );

      scores.push(...batchScores);
      processed += batchScores.length;

      console.log(`[${translationModel}] ${formatProgress(processed, total, startTime)}`);

      if (useCheckpoint) {
        saveCheckpoint(checkpointPath, {
          judgeModel: judgeModelId,
          translationModel,
          completedFixtureIds: scores.map((score) => score.fixtureId),
          scores,
        });
      }
    }

    allScores[translationModel] = scores;

    const validScores = scores.filter((score) => score.accuracy > 0);
    const avgAccuracy =
      validScores.reduce((sum, score) => sum + score.accuracy, 0) / Math.max(validScores.length, 1);
    const avgFluency =
      validScores.reduce((sum, score) => sum + score.fluency, 0) / Math.max(validScores.length, 1);
    const avgContext =
      validScores.reduce((sum, score) => sum + score.contextPreservation, 0) /
      Math.max(validScores.length, 1);
    console.log(
      `Avg accuracy: ${avgAccuracy.toFixed(2)}, fluency: ${avgFluency.toFixed(2)}, context: ${avgContext.toFixed(2)}`,
    );

    if (useCheckpoint && existsSync(checkpointPath)) {
      unlinkSync(checkpointPath);
    }
  }

  await unloadModel(endpoint, judgeModelId).catch(() => undefined);

  const output = {
    timestamp: Date.now(),
    endpoint,
    inputPath,
    fixturePath,
    judgeModel: judgeModelId,
    models: Object.keys(allScores),
    scores: allScores,
  };

  writeFileSync(outputPath, JSON.stringify(output, null, 2));
  console.log(`\nWrote quality scores: ${outputPath}`);
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
