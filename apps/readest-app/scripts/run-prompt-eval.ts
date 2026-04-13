#!/usr/bin/env tsx
/**
 * CLI for running prompt evaluation.
 *
 * Usage:
 *   npx tsx apps/readest-app/scripts/run-prompt-eval.ts
 *     --provider openai          # provider type (openai, anthropic, google, etc.)
 *     --model gpt-4o-mini        # model id
 *     --api-key <key>            # API key (or set via env: OPENAI_API_KEY, etc.)
 *     [--fixture <path>]         # path to fixture JSON (default: coreFixtures.json)
 *     [--output <path>]          # output JSON path (default: prompt-eval-results.json)
 */
import { readFileSync, writeFileSync } from 'fs';
import { resolve } from 'path';
import { parseArgs } from 'util';

// Dynamic import of ai SDK — adjust path for the monorepo
async function main() {
  const { values } = parseArgs({
    options: {
      provider: { type: 'string', default: 'openai' },
      model: { type: 'string', default: 'gpt-4o-mini' },
      'api-key': { type: 'string' },
      fixture: { type: 'string' },
      output: { type: 'string', default: 'prompt-eval-results.json' },
    },
  });

  const providerType = values.provider ?? 'openai';
  const modelId = values.model ?? 'gpt-4o-mini';
  const apiKey =
    values['api-key'] ??
    process.env[`${providerType.toUpperCase()}_API_KEY`] ??
    process.env['OPENAI_API_KEY'];

  if (!apiKey) {
    console.error(
      `Error: No API key. Pass --api-key or set ${providerType.toUpperCase()}_API_KEY env var.`,
    );
    process.exit(1);
  }

  const fixturePath = values.fixture
    ? resolve(values.fixture)
    : resolve(__dirname, '../src/services/contextTranslation/fixtures/coreFixtures.json');
  const outputPath = resolve(values.output ?? 'prompt-eval-results.json');

  console.log(`Loading fixtures from: ${fixturePath}`);
  const fixtures = JSON.parse(readFileSync(fixturePath, 'utf-8'));
  console.log(`Loaded ${fixtures.length} fixtures`);
  console.log(`Provider: ${providerType}, Model: ${modelId}`);

  // Dynamic import of the harness (uses TS paths — run via tsx)
  const { runPromptEval } = await import('../src/services/contextTranslation/promptTestHarness');

  // Create a simple model caller using the ai SDK
  const { generateText } = await import('ai');
  let createProvider: (opts: { apiKey: string }) => unknown;

  switch (providerType) {
    case 'openai':
      createProvider = (await import('@ai-sdk/openai')).createOpenAI;
      break;
    case 'anthropic':
      createProvider = (await import('@ai-sdk/anthropic')).createAnthropic;
      break;
    case 'google':
      createProvider = (await import('@ai-sdk/google')).createGoogleGenerativeAI;
      break;
    default:
      console.error(`Unsupported provider: ${providerType}. Use openai, anthropic, or google.`);
      process.exit(1);
  }

  const provider = createProvider({ apiKey }) as CallableFunction;
  const model = provider(modelId);

  const callModel = async (systemPrompt: string, userPrompt: string) => {
    const result = await generateText({
      model,
      system: systemPrompt,
      prompt: userPrompt,
    });
    return {
      text: result.text,
      promptTokens: result.usage?.promptTokens,
      completionTokens: result.usage?.completionTokens,
    };
  };

  console.log('Running evaluation...');
  const report = await runPromptEval(fixtures, callModel, {
    model: modelId,
    provider: providerType,
  });

  writeFileSync(outputPath, JSON.stringify(report, null, 2));
  console.log(`\nResults written to: ${outputPath}`);
  console.log(`Summary:`);
  console.log(`  Total: ${report.summary.totalFixtures}`);
  console.log(`  Succeeded: ${report.summary.succeeded}`);
  console.log(`  Failed: ${report.summary.failed}`);
  console.log(`  Avg latency: ${report.summary.averageLatencyMs}ms`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
