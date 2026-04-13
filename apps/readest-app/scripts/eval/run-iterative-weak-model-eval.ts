#!/usr/bin/env tsx
import { existsSync, readFileSync, unlinkSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { parseArgs } from 'node:util';
import type { PromptTestFixture, PromptTestResult } from '@/services/contextTranslation/promptTestHarness';
import { runPromptEval } from '@/services/contextTranslation/promptTestHarness';
import {
  runProductionPromptEval,
} from './productionTranslationEval';
import {
  getFixturePair,
  sampleFixturesByPair,
  selectTranslationModels,
} from './evalHarnessUtils';

type ChatResponse = {
  choices?: Array<{ message?: { content?: string } }>;
  usage?: { prompt_tokens?: number; completion_tokens?: number };
};

type ModelRecord = {
  id: string;
  object?: string;
};

type Checkpoint = {
  model: string;
  completedFixtureIds: string[];
  results: Array<PromptTestResult & { structuralFlags?: Record<string, boolean> }>;
};

type EvalFlow = 'prompt' | 'production';
type EvalResult = PromptTestResult & { structuralFlags?: Record<string, boolean> };

const RETRY_DELAYS_MS = [250, 750];

function isWeakModel(modelId: string): boolean {
  return [/0\.8B/i, /E2B/i, /[_-]1B/i, /[_-]2B/i].some((pattern) => pattern.test(modelId));
}

function getModelTier(modelId: string): 'weak' | 'strong' {
  return isWeakModel(modelId) ? 'weak' : 'strong';
}

function isRetryableStatus(status: number): boolean {
  return status >= 500 && status < 600;
}

function isRetryableModelError(message: string): boolean {
  const normalized = message.toLowerCase();
  return (
    normalized.includes('proxy error') ||
    normalized.includes('could not establish connection') ||
    normalized.includes('timed out') ||
    normalized.includes('timeout') ||
    normalized.includes('500') ||
    normalized.includes('502') ||
    normalized.includes('503') ||
    normalized.includes('504')
  );
}

function isProxyConnectionFailure(result: PromptTestResult | undefined): boolean {
  if (!result) {
    return false;
  }

  if (Object.keys(result.fields ?? {}).length > 0) {
    return false;
  }

  const raw = String(result.rawResponse ?? '').toLowerCase();
  return raw.includes('proxy error') || raw.includes('could not establish connection');
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolvePromise) => setTimeout(resolvePromise, ms));
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

function loadCheckpoint(checkpointPath: string, model: string): Checkpoint | null {
  if (!existsSync(checkpointPath)) {
    return null;
  }

  try {
    const data = JSON.parse(readFileSync(checkpointPath, 'utf8')) as Checkpoint;
    return data.model === model ? data : null;
  } catch {
    return null;
  }
}

function saveCheckpoint(checkpointPath: string, checkpoint: Checkpoint): void {
  writeFileSync(checkpointPath, JSON.stringify(checkpoint, null, 2));
}

async function requestJson(url: string, init: RequestInit): Promise<unknown> {
  for (let attempt = 0; attempt <= RETRY_DELAYS_MS.length; attempt += 1) {
    const response = await fetch(url, init);
    if (!response.ok) {
      const body = await response.text();
      if (isRetryableStatus(response.status) && attempt < RETRY_DELAYS_MS.length) {
        const retryDelayMs = RETRY_DELAYS_MS[Math.min(attempt, RETRY_DELAYS_MS.length - 1)] ?? 0;
        await sleep(retryDelayMs);
        continue;
      }

      throw new Error(`${init.method ?? 'GET'} ${url} failed (${response.status}) :: ${body}`);
    }

    return response.json();
  }

  throw new Error(`${init.method ?? 'GET'} ${url} failed after retries`);
}

async function postLifecycle(baseUrl: string, path: string, model: string): Promise<void> {
  for (let attempt = 0; attempt <= RETRY_DELAYS_MS.length; attempt += 1) {
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

    if (isRetryableStatus(response.status) && attempt < RETRY_DELAYS_MS.length) {
      const retryDelayMs = RETRY_DELAYS_MS[Math.min(attempt, RETRY_DELAYS_MS.length - 1)] ?? 0;
        await sleep(retryDelayMs);
      continue;
    }

    throw new Error(`POST ${baseUrl}${path} failed (${response.status}) :: ${body}`);
  }

  throw new Error(`POST ${baseUrl}${path} failed after retries`);
}

async function listModels(baseUrl: string): Promise<ModelRecord[]> {
  const payload = (await requestJson(`${baseUrl}/v1/models`, {
    method: 'GET',
    headers: { 'Content-Type': 'application/json' },
  })) as { data?: ModelRecord[] };

  return payload.data ?? [];
}

async function unloadModel(baseUrl: string, model: string): Promise<void> {
  try {
    await postLifecycle(baseUrl, '/models/unload', model);
  } catch {
    await postLifecycle(baseUrl, '/v1/models/unload', model);
  }
}

async function loadModel(baseUrl: string, model: string): Promise<void> {
  try {
    await postLifecycle(baseUrl, '/models/load', model);
  } catch {
    await postLifecycle(baseUrl, '/v1/models/load', model);
  }
}

async function unloadAll(baseUrl: string, models: string[]): Promise<void> {
  for (const model of models) {
    try {
      await unloadModel(baseUrl, model);
    } catch {
      // Ignore unload failures for models that are not currently loaded.
    }
  }
}

async function callOpenAICompat(
  baseUrl: string,
  model: string,
  systemPrompt: string,
  userPrompt: string,
): Promise<{ text: string; promptTokens?: number; completionTokens?: number }> {
  let lastError: Error | null = null;
  const maxAttempts = 4;

  for (let attempt = 1; attempt <= maxAttempts; attempt += 1) {
    try {
      const payload = (await requestJson(`${baseUrl}/v1/chat/completions`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          model,
          temperature: 0.1,
          max_tokens: 500,
          messages: [
            { role: 'system', content: systemPrompt },
            { role: 'user', content: userPrompt },
          ],
        }),
      })) as ChatResponse;

      const text = payload.choices?.[0]?.message?.content ?? '';
      return {
        text,
        promptTokens: payload.usage?.prompt_tokens,
        completionTokens: payload.usage?.completion_tokens,
      };
    } catch (error) {
      const normalized = error instanceof Error ? error : new Error(String(error));
      lastError = normalized;
      if (!isRetryableModelError(normalized.message) || attempt === maxAttempts) {
        throw normalized;
      }

      await sleep(500 * attempt);
    }
  }

  throw lastError ?? new Error('Unknown chat completion failure');
}

async function verifyModelHealthy(baseUrl: string, model: string): Promise<void> {
  let lastError: Error | null = null;

  for (let attempt = 0; attempt < 3; attempt += 1) {
    try {
      const probe = await callOpenAICompat(
        baseUrl,
        model,
        'You are a health-check assistant.',
        'Reply with exactly: OK',
      );
      if (probe.text.trim().length > 0) {
        return;
      }
    } catch (error) {
      lastError = error instanceof Error ? error : new Error(String(error));
    }

    await sleep(800);
  }

  throw new Error(
    `Model health check failed for ${model}. Last error: ${lastError?.message ?? 'empty probe response'}`,
  );
}

function summarize(report: { results: EvalResult[]; summary: { averageLatencyMs: number } }) {
  const usabilityScores = report.results
    .map((result) => result.scores?.['usability'])
    .filter((score): score is number => typeof score === 'number');
  const structuralUsability = report.results.map((result) =>
    result.structuralFlags?.['missingPrimary'] || result.structuralFlags?.['parsedMeta'] ? 0 : 1,
  );
  const usableCases =
    usabilityScores.length > 0
      ? usabilityScores.filter((score) => score >= 0.65).length
      : structuralUsability.filter((score) => score >= 1).length;
  const avgUsability = Number(
    (
      (usabilityScores.length > 0
        ? usabilityScores.reduce((sum, score) => sum + score, 0) / usabilityScores.length
        : structuralUsability.reduce((sum, score) => sum + score, 0) /
          Math.max(structuralUsability.length, 1))
    ).toFixed(3),
  );

  const avgAttempts = Number(
    (
      report.results.reduce((sum, result) => sum + (result.attemptCount ?? 1), 0) /
      Math.max(report.results.length, 1)
    ).toFixed(2),
  );

  return {
    total: report.results.length,
    usableCases,
    usableRate: Number((usableCases / Math.max(report.results.length, 1)).toFixed(3)),
    avgUsability,
    avgAttempts,
    avgLatencyMs: report.summary.averageLatencyMs,
    parsedMetaCount: report.results.filter((result) => result.structuralFlags?.['parsedMeta']).length,
    missingPrimaryCount: report.results.filter((result) => result.structuralFlags?.['missingPrimary'])
      .length,
    rawContaminatedCount: report.results.filter(
      (result) => result.structuralFlags?.['rawContaminated'],
    ).length,
  };
}

async function main() {
  const { values } = parseArgs({
    options: {
      endpoint: { type: 'string', default: 'http://127.0.0.1:8081' },
      fixture: { type: 'string', default: 'scripts/eval/mini-weak-clusters-fixtures.json' },
      output: { type: 'string', default: `scripts/eval/iterative-weak-model-${Date.now()}.json` },
      'per-pair': { type: 'string', default: '10' },
      models: { type: 'string' },
      checkpoint: { type: 'boolean', default: false },
      flow: { type: 'string', default: 'prompt' },
    },
  });

  const endpoint = String(values.endpoint ?? 'http://127.0.0.1:8081').replace(/\/$/, '');
  const fixturePath = resolve(String(values.fixture));
  const outputPath = resolve(String(values.output));
  const perPair = Number(values['per-pair'] ?? '10');
  const useCheckpoint = Boolean(values.checkpoint);
  const flow = String(values.flow ?? 'prompt') as EvalFlow;

  if (flow !== 'prompt' && flow !== 'production') {
    throw new Error(`Unsupported flow: ${flow}`);
  }

  const allFixtures = JSON.parse(readFileSync(fixturePath, 'utf8')) as PromptTestFixture[];
  const fixtures = sampleFixturesByPair(allFixtures, perPair);
  const fixturePairs = [...new Set(fixtures.map((fixture) => getFixturePair(fixture)))].sort();

  console.log(`Loaded ${allFixtures.length} fixtures, sampled ${fixtures.length} (${perPair}/pair)`);

  const availableModels = await listModels(endpoint);
  const requestedModels = values.models
    ? String(values.models)
        .split(',')
        .map((value) => value.trim())
        .filter(Boolean)
    : undefined;
  const modelSelection = selectTranslationModels(availableModels, requestedModels);
  const activeModels = modelSelection.activeModels;

  if (modelSelection.excludedModels.length > 0) {
    console.log(`Excluded non-translation models: ${modelSelection.excludedModels.join(', ')}`);
  }

  if (modelSelection.missingModels.length > 0) {
    console.warn(`Requested models missing from endpoint: ${modelSelection.missingModels.join(', ')}`);
  }

  if (activeModels.length === 0) {
    throw new Error('No matching translation models to evaluate.');
  }

  console.log(`Models: ${activeModels.map((model) => `${model} (${getModelTier(model)})`).join(', ')}`);

  const runReport: Record<string, unknown> = {
    timestamp: Date.now(),
    endpoint,
    fixturePath,
    sampledFixtureCount: fixtures.length,
    sampledPerPair: perPair,
    fixturePairs,
    fixturePairCount: fixturePairs.length,
    availableModels: availableModels.map((model) => model.id),
    requestedModels: requestedModels ?? null,
    flow,
    excludedModels: modelSelection.excludedModels,
    missingRequestedModels: modelSelection.missingModels,
    models: activeModels,
    summaries: {},
    reports: {},
  };

  await unloadAll(endpoint, availableModels.map((model) => model.id));

  for (const model of activeModels) {
    console.log(`\n${'='.repeat(60)}`);
    console.log(`Model: ${model} (tier: ${getModelTier(model)})`);
    console.log(`${'='.repeat(60)}`);

    await unloadAll(endpoint, availableModels.map((candidate) => candidate.id));
    await loadModel(endpoint, model);
    await verifyModelHealthy(endpoint, model);

    const checkpointPath = outputPath.replace(/\.json$/, `.checkpoint-${model.replace(/[/\\:]/g, '_')}.json`);
    const checkpoint = useCheckpoint ? loadCheckpoint(checkpointPath, model) : null;
    const completedFixtureIds = new Set(checkpoint?.completedFixtureIds ?? []);
    const remainingFixtures = checkpoint
      ? fixtures.filter((fixture) => !completedFixtureIds.has(fixture.id))
      : fixtures;

    if (checkpoint) {
      console.log(
        `Resumed from checkpoint: ${completedFixtureIds.size} already done, ${remainingFixtures.length} remaining`,
      );
    }

    const startTime = Date.now();
    let processed = checkpoint?.completedFixtureIds.length ?? 0;
    const total = fixtures.length;
    const allResults: EvalResult[] = [...(checkpoint?.results ?? [])];

    for (const fixture of remainingFixtures) {
      let singleReport =
        flow === 'production'
          ? await runProductionPromptEval(
              [fixture],
              (systemPrompt, userPrompt) =>
                callOpenAICompat(endpoint, model, systemPrompt, userPrompt),
              { model, provider: 'openai-compatible' },
            )
          : await runPromptEval(
              [fixture],
              (systemPrompt, userPrompt) =>
                callOpenAICompat(endpoint, model, systemPrompt, userPrompt),
              { model, provider: 'openai-compatible' },
            );

      let proxyRetryCount = 0;
      while (isProxyConnectionFailure(singleReport.results[0]) && proxyRetryCount < 2) {
        proxyRetryCount += 1;
        console.warn(
          `[${model}] proxy connection failure on ${fixture.id}; reloading model and retrying (${proxyRetryCount}/2)`,
        );

        await unloadModel(endpoint, model).catch(() => undefined);
        await loadModel(endpoint, model);
        await verifyModelHealthy(endpoint, model);

        singleReport =
          flow === 'production'
            ? await runProductionPromptEval(
                [fixture],
                (systemPrompt, userPrompt) =>
                  callOpenAICompat(endpoint, model, systemPrompt, userPrompt),
                { model, provider: 'openai-compatible' },
              )
            : await runPromptEval(
                [fixture],
                (systemPrompt, userPrompt) =>
                  callOpenAICompat(endpoint, model, systemPrompt, userPrompt),
                { model, provider: 'openai-compatible' },
              );
      }

      allResults.push(...singleReport.results);
      processed += 1;

      if (processed % 10 === 0 || processed === total) {
        console.log(`[${model}] ${formatProgress(processed, total, startTime)}`);
      }

      if (useCheckpoint && processed % 50 === 0) {
        saveCheckpoint(checkpointPath, {
          model,
          completedFixtureIds: allResults.map((result) => result.fixtureId),
          results: allResults,
        });
      }
    }

    const totalLatency = allResults.reduce((sum, result) => sum + result.latencyMs, 0);
    const fullReport: {
      runId: string;
      startedAt: number;
      completedAt: number;
      model: string;
      provider: string;
      results: EvalResult[];
      summary: {
        totalFixtures: number;
        succeeded: number;
        failed: number;
        averageLatencyMs: number;
      };
    } = {
      runId: `${model}-${Date.now()}`,
      startedAt: startTime,
      completedAt: Date.now(),
      model,
      provider: 'openai-compatible',
      results: allResults,
      summary: {
        totalFixtures: allResults.length,
        succeeded: allResults.filter((result) => Object.keys(result.fields).length > 0).length,
        failed: allResults.filter((result) => Object.keys(result.fields).length === 0).length,
        averageLatencyMs: Math.round(totalLatency / Math.max(allResults.length, 1)),
      },
    };

    (runReport['summaries'] as Record<string, unknown>)[model] = summarize(fullReport);
    (runReport['reports'] as Record<string, unknown>)[model] = fullReport;

    if (useCheckpoint && existsSync(checkpointPath)) {
      unlinkSync(checkpointPath);
    }

    await unloadModel(endpoint, model).catch(() => undefined);
    console.log(`Done: ${JSON.stringify((runReport['summaries'] as Record<string, unknown>)[model])}`);
  }

  writeFileSync(outputPath, JSON.stringify(runReport, null, 2));
  console.log(`\nWrote iterative evaluation report: ${outputPath}`);
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});

