#!/usr/bin/env tsx
import { readFileSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { parseArgs } from 'node:util';

interface TranslationResult {
  fixtureId: string;
  model: string;
  fields: Record<string, string>;
  latencyMs: number;
  scores?: Record<string, number>;
  attemptCount?: number;
}

interface EvalReport {
  model: string;
  results: TranslationResult[];
  summary: { totalFixtures: number; succeeded: number; failed: number; averageLatencyMs: number };
}

interface JudgeScore {
  fixtureId: string;
  translationModel: string;
  accuracy: number;
  fluency: number;
  contextPreservation: number;
  rationale: string;
}

interface ModelSummary {
  model: string;
  tier: string;
  totalFixtures: number;
  usableRate: number;
  avgUsability: number;
  avgAttempts: number;
  avgLatencyMs: number;
  avgAccuracy: number;
  avgFluency: number;
  avgContextPreservation: number;
  compositeQuality: number;
}

interface PairBreakdown {
  pair: string;
  sourceLanguage: string;
  targetLanguage: string;
  count: number;
  avgAccuracy: number;
  avgFluency: number;
  avgContextPreservation: number;
  compositeQuality: number;
}

interface LanguageBreakdown {
  language: string;
  count: number;
  avgAccuracy: number;
  avgFluency: number;
  avgContextPreservation: number;
  compositeQuality: number;
}

function getModelTier(modelId: string): string {
  return [/0\.8B/i, /E2B/i, /[_-]1B/i, /[_-]2B/i].some((pattern) => pattern.test(modelId))
    ? 'weak'
    : 'strong';
}

function avg(values: number[]): number {
  if (values.length === 0) {
    return 0;
  }
  return values.reduce((sum, value) => sum + value, 0) / values.length;
}

function compositeScore(accuracy: number, fluency: number, contextPreservation: number): number {
  return accuracy * 0.4 + fluency * 0.3 + contextPreservation * 0.3;
}

function buildLanguageBreakdown(
  entries: { language: string; accuracy: number; fluency: number; context: number }[],
): LanguageBreakdown[] {
  const byLanguage = new Map<
    string,
    { accuracy: number[]; fluency: number[]; context: number[] }
  >();

  for (const entry of entries) {
    if (!byLanguage.has(entry.language)) {
      byLanguage.set(entry.language, { accuracy: [], fluency: [], context: [] });
    }

    const bucket = byLanguage.get(entry.language);
    if (!bucket) {
      continue;
    }

    bucket.accuracy.push(entry.accuracy);
    bucket.fluency.push(entry.fluency);
    bucket.context.push(entry.context);
  }

  return [...byLanguage.entries()]
    .map(([language, values]) => ({
      language,
      count: values.accuracy.length,
      avgAccuracy: Number(avg(values.accuracy).toFixed(2)),
      avgFluency: Number(avg(values.fluency).toFixed(2)),
      avgContextPreservation: Number(avg(values.context).toFixed(2)),
      compositeQuality: Number(
        compositeScore(avg(values.accuracy), avg(values.fluency), avg(values.context)).toFixed(2),
      ),
    }))
    .sort((left, right) => right.compositeQuality - left.compositeQuality);
}

async function main() {
  const { values } = parseArgs({
    options: {
      'eval-results': { type: 'string' },
      'quality-scores': { type: 'string' },
      output: { type: 'string', default: 'scripts/eval/eval-report' },
    },
  });

  if (!values['eval-results']) {
    console.error(
      'Usage: --eval-results <file.json> [--quality-scores <file.json>] [--output <prefix>]',
    );
    process.exit(1);
  }

  const evalData = JSON.parse(readFileSync(resolve(String(values['eval-results'])), 'utf8'));
  const reports: Record<string, EvalReport> = evalData.reports ?? {};

  let qualityData: Record<string, JudgeScore[]> = {};
  let qualityMeta: {
    judgeModel: string | null;
    qualityTimestamp: number | null;
    qualityFixturePath: string | null;
    qualityInputPath: string | null;
  } = {
    judgeModel: null,
    qualityTimestamp: null,
    qualityFixturePath: null,
    qualityInputPath: null,
  };
  if (values['quality-scores']) {
    const parsed = JSON.parse(readFileSync(resolve(String(values['quality-scores'])), 'utf8'));
    qualityData = parsed.scores ?? {};
    qualityMeta = {
      judgeModel: parsed.judgeModel ?? null,
      qualityTimestamp: parsed.timestamp ?? null,
      qualityFixturePath: parsed.fixturePath ?? null,
      qualityInputPath: parsed.inputPath ?? null,
    };
  }

  const outputPrefix = resolve(String(values.output));
  const modelSummaries: ModelSummary[] = [];

  for (const [model, report] of Object.entries(reports)) {
    const usabilityScores = report.results
      .map((result) => result.scores?.['usability'])
      .filter((score): score is number => typeof score === 'number');
    const usable = usabilityScores.filter((score) => score >= 0.65).length;
    const judgeScores = (qualityData[model] ?? []).filter((score) => score.accuracy > 0);

    modelSummaries.push({
      model,
      tier: getModelTier(model),
      totalFixtures: report.results.length,
      usableRate: Number((usable / Math.max(report.results.length, 1)).toFixed(3)),
      avgUsability: Number(avg(usabilityScores).toFixed(3)),
      avgAttempts: Number(avg(report.results.map((result) => result.attemptCount ?? 1)).toFixed(2)),
      avgLatencyMs: Math.round(avg(report.results.map((result) => result.latencyMs))),
      avgAccuracy: Number(avg(judgeScores.map((score) => score.accuracy)).toFixed(2)),
      avgFluency: Number(avg(judgeScores.map((score) => score.fluency)).toFixed(2)),
      avgContextPreservation: Number(
        avg(judgeScores.map((score) => score.contextPreservation)).toFixed(2),
      ),
      compositeQuality: Number(
        compositeScore(
          avg(judgeScores.map((score) => score.accuracy)),
          avg(judgeScores.map((score) => score.fluency)),
          avg(judgeScores.map((score) => score.contextPreservation)),
        ).toFixed(2),
      ),
    });
  }

  modelSummaries.sort((left, right) => right.compositeQuality - left.compositeQuality);

  const pairBreakdowns: Record<string, PairBreakdown[]> = {};
  const sourceLanguageBreakdowns: Record<string, LanguageBreakdown[]> = {};
  const targetLanguageBreakdowns: Record<string, LanguageBreakdown[]> = {};

  for (const [model, report] of Object.entries(reports)) {
    const judgeMap = new Map((qualityData[model] ?? []).map((score) => [score.fixtureId, score]));
    const pairData = new Map<
      string,
      { accuracy: number[]; fluency: number[]; context: number[]; count: number }
    >();

    for (const result of report.results) {
      const parts = result.fixtureId.split('-');
      if (parts.length < 3) {
        continue;
      }

      const sourceLanguage = parts[0] ?? '';
      const targetLanguage = parts[1] ?? '';
      const pair = `${sourceLanguage}->${targetLanguage}`;

      if (!pairData.has(pair)) {
        pairData.set(pair, { accuracy: [], fluency: [], context: [], count: 0 });
      }

      const bucket = pairData.get(pair);
      if (!bucket) {
        continue;
      }

      bucket.count += 1;
      const score = judgeMap.get(result.fixtureId);
      if (score && score.accuracy > 0) {
        bucket.accuracy.push(score.accuracy);
        bucket.fluency.push(score.fluency);
        bucket.context.push(score.contextPreservation);
      }
    }

    pairBreakdowns[model] = [...pairData.entries()]
      .map(([pair, bucket]) => ({
        pair,
        sourceLanguage: pair.split('->')[0] ?? '',
        targetLanguage: pair.split('->')[1] ?? '',
        count: bucket.count,
        avgAccuracy: Number(avg(bucket.accuracy).toFixed(2)),
        avgFluency: Number(avg(bucket.fluency).toFixed(2)),
        avgContextPreservation: Number(avg(bucket.context).toFixed(2)),
        compositeQuality: Number(
          compositeScore(avg(bucket.accuracy), avg(bucket.fluency), avg(bucket.context)).toFixed(2),
        ),
      }))
      .sort((left, right) => right.compositeQuality - left.compositeQuality);

    const languageEntries = report.results.flatMap((result) => {
      const parts = result.fixtureId.split('-');
      if (parts.length < 3) {
        return [];
      }

      const score = judgeMap.get(result.fixtureId);
      if (!score || score.accuracy <= 0) {
        return [];
      }

      return [
        {
          sourceLanguage: parts[0] ?? '',
          targetLanguage: parts[1] ?? '',
          accuracy: score.accuracy,
          fluency: score.fluency,
          context: score.contextPreservation,
        },
      ];
    });

    sourceLanguageBreakdowns[model] = buildLanguageBreakdown(
      languageEntries.map((entry) => ({
        language: entry.sourceLanguage,
        accuracy: entry.accuracy,
        fluency: entry.fluency,
        context: entry.context,
      })),
    );

    targetLanguageBreakdowns[model] = buildLanguageBreakdown(
      languageEntries.map((entry) => ({
        language: entry.targetLanguage,
        accuracy: entry.accuracy,
        fluency: entry.fluency,
        context: entry.context,
      })),
    );
  }

  const lines: string[] = [];
  lines.push('# Multilingual Translation Evaluation Report');
  lines.push('');
  lines.push(`Generated: ${new Date().toISOString()}`);
  lines.push(`Total models: ${modelSummaries.length}`);
  lines.push(`Fixtures per model: ${modelSummaries[0]?.totalFixtures ?? 0}`);
  lines.push('');
  lines.push('## Run Metadata');
  lines.push('');
  lines.push(`- Endpoint: ${String(evalData.endpoint ?? 'unknown')}`);
  lines.push(`- Fixture file: ${String(evalData.fixturePath ?? 'unknown')}`);
  lines.push(`- Sampled per pair: ${String(evalData.sampledPerPair ?? 'unknown')}`);
  lines.push(`- Sampled fixture count: ${String(evalData.sampledFixtureCount ?? 'unknown')}`);
  lines.push(`- Fixture pair count: ${String(evalData.fixturePairCount ?? 'unknown')}`);
  lines.push(`- Active translation models: ${(evalData.models ?? []).join(', ') || 'none'}`);
  lines.push(`- Excluded endpoint models: ${(evalData.excludedModels ?? []).join(', ') || 'none'}`);
  lines.push(
    `- Missing requested models: ${(evalData.missingRequestedModels ?? []).join(', ') || 'none'}`,
  );
  if (qualityMeta.judgeModel) {
    lines.push(`- Judge model: ${String(qualityMeta.judgeModel)}`);
  }
  lines.push('');
  lines.push('## Model Rankings');
  lines.push('');
  lines.push(
    '| Rank | Model | Tier | Usable% | Avg Usability | Avg Accuracy | Avg Fluency | Avg Context | Composite | Avg Latency |',
  );
  lines.push(
    '|------|-------|------|---------|---------------|-------------|-------------|-------------|-----------|-------------|',
  );
  modelSummaries.forEach((summary, index) => {
    lines.push(
      `| ${index + 1} | ${summary.model} | ${summary.tier} | ${(summary.usableRate * 100).toFixed(1)}% | ${summary.avgUsability} | ${summary.avgAccuracy} | ${summary.avgFluency} | ${summary.avgContextPreservation} | **${summary.compositeQuality}** | ${summary.avgLatencyMs}ms |`,
    );
  });
  lines.push('');

  for (const summary of modelSummaries) {
    const pairs = pairBreakdowns[summary.model] ?? [];
    if (pairs.length === 0) {
      continue;
    }

    lines.push(`## ${summary.model} - Language Pair Breakdown`);
    lines.push('');

    const sourceLanguages = sourceLanguageBreakdowns[summary.model] ?? [];
    if (sourceLanguages.length > 0) {
      lines.push('### Source Languages');
      lines.push('| Source | Count | Accuracy | Fluency | Context | Composite |');
      lines.push('|--------|-------|----------|---------|---------|-----------|');
      sourceLanguages.forEach((language) => {
        lines.push(
          `| ${language.language} | ${language.count} | ${language.avgAccuracy} | ${language.avgFluency} | ${language.avgContextPreservation} | ${language.compositeQuality} |`,
        );
      });
      lines.push('');
    }

    const targetLanguages = targetLanguageBreakdowns[summary.model] ?? [];
    if (targetLanguages.length > 0) {
      lines.push('### Target Languages');
      lines.push('| Target | Count | Accuracy | Fluency | Context | Composite |');
      lines.push('|--------|-------|----------|---------|---------|-----------|');
      targetLanguages.forEach((language) => {
        lines.push(
          `| ${language.language} | ${language.count} | ${language.avgAccuracy} | ${language.avgFluency} | ${language.avgContextPreservation} | ${language.compositeQuality} |`,
        );
      });
      lines.push('');
    }

    lines.push('### Best Pairs');
    lines.push('| Pair | Count | Accuracy | Fluency | Context | Composite |');
    lines.push('|------|-------|----------|---------|---------|-----------|');
    pairs.slice(0, 5).forEach((pair) => {
      lines.push(
        `| ${pair.pair} | ${pair.count} | ${pair.avgAccuracy} | ${pair.avgFluency} | ${pair.avgContextPreservation} | ${pair.compositeQuality} |`,
      );
    });
    lines.push('');

    lines.push('### Worst Pairs');
    lines.push('| Pair | Count | Accuracy | Fluency | Context | Composite |');
    lines.push('|------|-------|----------|---------|---------|-----------|');
    pairs.slice(-5).forEach((pair) => {
      lines.push(
        `| ${pair.pair} | ${pair.count} | ${pair.avgAccuracy} | ${pair.avgFluency} | ${pair.avgContextPreservation} | ${pair.compositeQuality} |`,
      );
    });
    lines.push('');
  }

  writeFileSync(`${outputPrefix}.md`, lines.join('\n'), 'utf8');
  console.log(`Wrote: ${outputPrefix}.md`);

  const csvLines = [
    'model,tier,totalFixtures,usableRate,avgUsability,avgAttempts,avgLatencyMs,avgAccuracy,avgFluency,avgContextPreservation,compositeQuality',
  ];
  for (const summary of modelSummaries) {
    csvLines.push(
      `${summary.model},${summary.tier},${summary.totalFixtures},${summary.usableRate},${summary.avgUsability},${summary.avgAttempts},${summary.avgLatencyMs},${summary.avgAccuracy},${summary.avgFluency},${summary.avgContextPreservation},${summary.compositeQuality}`,
    );
  }
  writeFileSync(`${outputPrefix}.csv`, csvLines.join('\n'), 'utf8');
  console.log(`Wrote: ${outputPrefix}.csv`);

  const jsonSummary = {
    timestamp: Date.now(),
    runMeta: {
      endpoint: evalData.endpoint ?? null,
      fixturePath: evalData.fixturePath ?? null,
      sampledPerPair: evalData.sampledPerPair ?? null,
      sampledFixtureCount: evalData.sampledFixtureCount ?? null,
      fixturePairCount: evalData.fixturePairCount ?? null,
      fixturePairs: evalData.fixturePairs ?? [],
      availableModels: evalData.availableModels ?? [],
      requestedModels: evalData.requestedModels ?? null,
      excludedModels: evalData.excludedModels ?? [],
      missingRequestedModels: evalData.missingRequestedModels ?? [],
      judgeModel: qualityMeta.judgeModel ?? null,
    },
    modelSummaries,
    pairBreakdowns,
    sourceLanguageBreakdowns,
    targetLanguageBreakdowns,
  };
  writeFileSync(`${outputPrefix}.json`, JSON.stringify(jsonSummary, null, 2), 'utf8');
  console.log(`Wrote: ${outputPrefix}.json`);
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
