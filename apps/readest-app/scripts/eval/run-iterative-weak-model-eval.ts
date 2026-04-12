#!/usr/bin/env tsx
import { readFileSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { parseArgs } from 'node:util';
import type { PromptTestFixture } from '@/services/contextTranslation/promptTestHarness';
import { runPromptEval } from '@/services/contextTranslation/promptTestHarness';

type ChatResponse = {
  choices?: Array<{ message?: { content?: string } }>;
  usage?: { prompt_tokens?: number; completion_tokens?: number };
};

type ModelRecord = {
  id: string;
  object?: string;
};

function sampleFixtures(fixtures: PromptTestFixture[], perPair: number): PromptTestFixture[] {
  const byPair = new Map<string, PromptTestFixture[]>();
  for (const fixture of fixtures) {
    const key = `${fixture.sourceLanguage}->${fixture.targetLanguage}`;
    if (!byPair.has(key)) {
      byPair.set(key, []);
    }
    byPair.get(key)?.push(fixture);
  }

  const sampled: PromptTestFixture[] = [];
  for (const [, items] of byPair.entries()) {
    sampled.push(...items.slice(0, perPair));
  }
  return sampled;
}

async function requestJson(url: string, init: RequestInit): Promise<unknown> {
  const response = await fetch(url, init);
  if (!response.ok) {
    const body = await response.text();
    throw new Error(`${init.method ?? 'GET'} ${url} failed (${response.status}) :: ${body}`);
  }
  return response.json();
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

async function listModels(baseUrl: string): Promise<ModelRecord[]> {
  const payload = (await requestJson(`${baseUrl}/v1/models`, {
    method: 'GET',
    headers: { 'Content-Type': 'application/json' },
  })) as { data?: ModelRecord[] };

  return (payload.data ?? []).filter((model) => !model.id.toLowerCase().includes('embedding'));
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
}

function summarize(report: Awaited<ReturnType<typeof runPromptEval>>) {
  const usabilityScores = report.results
    .map((result) => result.scores?.usability)
    .filter((score): score is number => typeof score === 'number');
  const usableCases = usabilityScores.filter((score) => score >= 0.65).length;
  const avgUsability =
    usabilityScores.length > 0
      ? Number(
          (
            usabilityScores.reduce((sum, score) => sum + score, 0) /
            usabilityScores.length
          ).toFixed(3),
        )
      : 0;

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
  };
}

async function main() {
  const { values } = parseArgs({
    options: {
      endpoint: { type: 'string', default: 'http://127.0.0.1:8081' },
      fixture: {
        type: 'string',
        default: 'src/services/contextTranslation/fixtures/handwrittenLong30x50Fixtures.json',
      },
      output: { type: 'string', default: `scripts/eval/iterative-weak-model-${Date.now()}.json` },
      'per-pair': { type: 'string', default: '5' },
      models: { type: 'string' },
    },
  });

  const endpoint = String(values.endpoint ?? 'http://127.0.0.1:8081').replace(/\/$/, '');
  const fixturePath = resolve(String(values.fixture));
  const outputPath = resolve(String(values.output));
  const perPair = Number(values['per-pair'] ?? '5');

  const allFixtures = JSON.parse(readFileSync(fixturePath, 'utf8')) as PromptTestFixture[];
  const fixtures = sampleFixtures(allFixtures, perPair);

  const availableModels = await listModels(endpoint);
  const targetModels = values.models
    ? String(values.models)
        .split(',')
        .map((v) => v.trim())
        .filter(Boolean)
    : availableModels.map((model) => model.id);

  const activeModels = targetModels.filter((model) =>
    availableModels.some((candidate) => candidate.id === model),
  );

  if (activeModels.length === 0) {
    throw new Error('No matching models to evaluate.');
  }

  const runReport: Record<string, unknown> = {
    timestamp: Date.now(),
    endpoint,
    fixturePath,
    sampledFixtureCount: fixtures.length,
    sampledPerPair: perPair,
    models: activeModels,
    summaries: {},
    reports: {},
  };

  await unloadAll(endpoint, availableModels.map((m) => m.id));

  for (const model of activeModels) {
    await unloadAll(endpoint, availableModels.map((m) => m.id));
    await loadModel(endpoint, model);

    const report = await runPromptEval(
      fixtures,
      (systemPrompt, userPrompt) => callOpenAICompat(endpoint, model, systemPrompt, userPrompt),
      { model, provider: 'openai-compatible' },
    );

    (runReport.summaries as Record<string, unknown>)[model] = summarize(report);
    (runReport.reports as Record<string, unknown>)[model] = report;

    await unloadModel(endpoint, model).catch(() => undefined);
  }

  writeFileSync(outputPath, JSON.stringify(runReport, null, 2));
  console.log(`Wrote iterative evaluation report: ${outputPath}`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
