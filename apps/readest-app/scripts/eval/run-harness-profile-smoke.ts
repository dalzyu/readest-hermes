#!/usr/bin/env tsx
import { readFileSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { parseArgs } from 'node:util';
import type { PromptTestFixture } from '@/services/contextTranslation/promptTestHarness';
import {
  CONTEXT_TRANSLATION_HARNESS_PRESETS,
  DEFAULT_CONTEXT_TRANSLATION_SETTINGS,
} from '@/services/contextTranslation/defaults';
import {
  buildPerFieldPrompt,
  buildTranslationPrompt,
} from '@/services/contextTranslation/promptBuilder';
import { parseTranslationResponse } from '@/services/contextTranslation/responseParser';
import {
  sanitizeFieldContent,
  sanitizeTranslationResult,
} from '@/services/contextTranslation/translationSanitizer';
import type {
  ContextTranslationHarnessSettings,
  TranslationOutputField,
} from '@/services/contextTranslation/types';
import { sampleFixturesByPair } from './evalHarnessUtils';

type HarnessPresetId = keyof typeof CONTEXT_TRANSLATION_HARNESS_PRESETS;

type ChatResponse = {
  choices?: Array<{ message?: { content?: string } }>;
  usage?: { prompt_tokens?: number; completion_tokens?: number };
};

type ModelRecord = { id: string };

type FixtureResult = {
  fixtureId: string;
  attempts: number;
  translation: string;
  contextualMeaning: string;
  parsedMeta: boolean;
  missingPrimary: boolean;
  rawContaminated: boolean;
};

type ProfileSummary = {
  profile: HarnessPresetId;
  model: string;
  totalFixtures: number;
  usableRate: number;
  avgAttempts: number;
  parsedMetaCount: number;
  missingPrimaryCount: number;
  rawContaminatedCount: number;
};

const DEFAULT_MODELS = [
  'Qwen3.5-0.8B-UD-Q6_K_XL',
  'Qwen3.5-4B-Q4_K_M',
  'Qwen3.5-9B-Q4_K_M',
  'gemma-4-E2B-it-Q4_K_M',
  'gemma-4-E4B-it-Q4_K_M',
] as const;

const OUTPUT_FIELDS = DEFAULT_CONTEXT_TRANSLATION_SETTINGS.outputFields.filter(
  (field) => field.enabled && field.id !== 'grammarHint',
);

function escapeRegexLiteral(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

function responseLooksContaminated(
  response: string,
  harness: ContextTranslationHarnessSettings,
): boolean {
  const markers = [...harness.contaminationMarkers, ...harness.reasoningMarkers]
    .map((marker) => escapeRegexLiteral(marker.trim()))
    .filter(Boolean);
  if (markers.length === 0) return false;
  return new RegExp(markers.join('|'), 'i').test(response);
}

function parsedFieldsLookContaminated(
  fields: Record<string, string>,
  harness: ContextTranslationHarnessSettings,
): boolean {
  return Object.values(fields).some(
    (value) =>
      responseLooksContaminated(value, harness) ||
      /^\s*\*/m.test(value) ||
      /Selected word:|Source Text:|Contextual Setup:|Narrative:|Original field request/i.test(
        value,
      ),
  );
}

function hasUsablePrimaryField(parsed: Record<string, string>): boolean {
  return Boolean(parsed.translation?.trim());
}

function completionRatio(parsed: Record<string, string>, fields: TranslationOutputField[]): number {
  const enabled = fields.filter((field) => field.enabled);
  if (enabled.length === 0) return 1;
  const present = enabled.filter((field) => Boolean(parsed[field.id]?.trim())).length;
  return present / enabled.length;
}

async function requestJson(url: string, init: RequestInit): Promise<unknown> {
  const response = await fetch(url, init);
  if (!response.ok) {
    throw new Error(
      `${init.method ?? 'GET'} ${url} failed (${response.status}) :: ${await response.text()}`,
    );
  }
  return response.json();
}

async function postLifecycle(baseUrl: string, path: string, model: string): Promise<void> {
  const response = await fetch(`${baseUrl}${path}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ model }),
  });

  if (response.ok) return;

  const body = (await response.text()).toLowerCase();
  if (
    response.status === 400 &&
    (body.includes('already running') ||
      body.includes('already loaded') ||
      body.includes('not running') ||
      body.includes('not loaded'))
  ) {
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

async function listModels(baseUrl: string): Promise<ModelRecord[]> {
  const payload = (await requestJson(`${baseUrl}/v1/models`, {
    method: 'GET',
    headers: { 'Content-Type': 'application/json' },
  })) as { data?: ModelRecord[] };

  return payload.data ?? [];
}

async function callOpenAICompat(
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
      temperature: 0.1,
      max_tokens: 500,
      messages: [
        { role: 'system', content: systemPrompt },
        { role: 'user', content: userPrompt },
      ],
    }),
  })) as ChatResponse;

  return payload.choices?.[0]?.message?.content ?? '';
}

function buildRequest(fixture: PromptTestFixture, harness: ContextTranslationHarnessSettings) {
  return {
    selectedText: fixture.sourceText,
    popupContext: {
      localPastContext: fixture.bookContext ?? '',
      localFutureBuffer: '',
      sameBookChunks: [],
      priorVolumeChunks: [],
      dictionaryEntries: [],
      retrievalStatus: 'local-only' as const,
      retrievalHints: {
        currentVolumeIndexed: false,
        missingLocalIndex: false,
        missingPriorVolumes: [],
        missingSeriesAssignment: false,
      },
    },
    sourceLanguage: fixture.sourceLanguage,
    targetLanguage: fixture.targetLanguage,
    outputFields: OUTPUT_FIELDS,
    harness,
  };
}

async function runFixture(
  baseUrl: string,
  model: string,
  fixture: PromptTestFixture,
  harness: ContextTranslationHarnessSettings,
): Promise<FixtureResult> {
  const request = buildRequest(fixture, harness);
  const { systemPrompt, userPrompt } = buildTranslationPrompt(request);

  let attempts = 1;
  const rawSegments: string[] = [];
  let rawResponse = await callOpenAICompat(baseUrl, model, systemPrompt, userPrompt);
  rawSegments.push(rawResponse);
  let parsed = sanitizeTranslationResult(
    parseTranslationResponse(rawResponse, request.outputFields),
    harness,
  );
  let contaminated = responseLooksContaminated(rawResponse, harness);

  const shouldRepair =
    harness.repairEnabled &&
    ((harness.repairOnContamination && contaminated) ||
      (harness.repairOnMissingPrimary && !hasUsablePrimaryField(parsed)) ||
      (harness.repairOnLowCompletion &&
        completionRatio(parsed, request.outputFields) < harness.completionThreshold));

  if (shouldRepair) {
    attempts += 1;
    const template = request.outputFields
      .map((field) => `<${field.id}>...</${field.id}>`)
      .join('\n');
    rawResponse = await callOpenAICompat(
      baseUrl,
      model,
      `${systemPrompt}

The previous answer did not follow the required XML shape.
Rewrite the answer now with ONLY these tags and in this exact order:
${template}
Do not include reasoning, markdown, or any extra text.`,
      `Retry the same request exactly and return only valid XML tags in the required order.

Original request:
${userPrompt}`,
    );
    rawSegments.push(rawResponse);
    parsed = sanitizeTranslationResult(
      parseTranslationResponse(rawResponse, request.outputFields),
      harness,
    );
    contaminated = responseLooksContaminated(rawResponse, harness);
  }

  if (harness.perFieldRescueEnabled && (contaminated || !hasUsablePrimaryField(parsed))) {
    const stitched: Record<string, string> = {};

    for (const field of request.outputFields) {
      attempts += 1;
      const perField = buildPerFieldPrompt(field, request);
      let fieldResponse = await callOpenAICompat(
        baseUrl,
        model,
        perField.systemPrompt,
        perField.userPrompt,
      );
      rawSegments.push(fieldResponse);
      let sanitized = sanitizeFieldContent(field.id, fieldResponse, harness);

      if (responseLooksContaminated(fieldResponse, harness) || !sanitized.trim()) {
        attempts += 1;
        fieldResponse = await callOpenAICompat(
          baseUrl,
          model,
          `You are a literary translation assistant.

Return ONLY the final ${field.id} content in ${request.targetLanguage}.
Do not reveal your reasoning. Do not write plans, XML tags, labels, markdown, or extra commentary.
Original field request:
${perField.systemPrompt}`,
          `Retry the same ${field.id} request and output only the final content.

Original request:
${perField.userPrompt}`,
        );
        rawSegments.push(fieldResponse);
        sanitized = sanitizeFieldContent(field.id, fieldResponse, harness);
      }

      stitched[field.id] = sanitized;
    }

    parsed = stitched;
  }

  return {
    fixtureId: fixture.id,
    attempts,
    translation: parsed.translation ?? '',
    contextualMeaning: parsed.contextualMeaning ?? '',
    parsedMeta: parsedFieldsLookContaminated(parsed, harness),
    missingPrimary: !hasUsablePrimaryField(parsed),
    rawContaminated: rawSegments.some((segment) => responseLooksContaminated(segment, harness)),
  };
}

async function main(): Promise<void> {
  const { values } = parseArgs({
    options: {
      endpoint: { type: 'string', default: 'http://127.0.0.1:8081' },
      fixture: {
        type: 'string',
        default: 'scripts/eval/mini-weak-clusters-fixtures.json',
      },
      perPair: { type: 'string', default: '1' },
      models: { type: 'string' },
      profiles: { type: 'string', default: 'balanced,strictGemma,lenientQwen' },
      output: {
        type: 'string',
        default: 'scripts/eval/harness-profile-smoke.json',
      },
    },
    allowPositionals: false,
  });

  const baseUrl = String(values.endpoint).replace(/\/$/, '');
  const fixturePath = resolve(String(values.fixture));
  const outputPath = resolve(String(values.output));
  const perPair = Math.max(1, parseInt(String(values.perPair), 10) || 1);
  const requestedModels = values.models
    ? String(values.models)
        .split(',')
        .map((item) => item.trim())
        .filter(Boolean)
    : [...DEFAULT_MODELS];
  const requestedProfiles = String(values.profiles)
    .split(',')
    .map((item) => item.trim() as HarnessPresetId)
    .filter((item): item is HarnessPresetId => item in CONTEXT_TRANSLATION_HARNESS_PRESETS);

  const allFixtures = JSON.parse(readFileSync(fixturePath, 'utf8')) as PromptTestFixture[];
  const fixtures = sampleFixturesByPair(allFixtures, perPair);
  const availableModels = new Set((await listModels(baseUrl)).map((model) => model.id));
  const models = requestedModels.filter((model) => availableModels.has(model));

  const results: Array<ProfileSummary & { fixtures: FixtureResult[] }> = [];

  for (const model of models) {
    await loadModel(baseUrl, model);

    for (const profile of requestedProfiles) {
      const harness = CONTEXT_TRANSLATION_HARNESS_PRESETS[profile];
      const fixtureResults: FixtureResult[] = [];

      for (const fixture of fixtures) {
        fixtureResults.push(await runFixture(baseUrl, model, fixture, harness));
      }

      const usableCases = fixtureResults.filter(
        (item) => !item.parsedMeta && !item.missingPrimary,
      ).length;
      results.push({
        profile,
        model,
        totalFixtures: fixtureResults.length,
        usableRate: Number((usableCases / Math.max(fixtureResults.length, 1)).toFixed(3)),
        avgAttempts: Number(
          (
            fixtureResults.reduce((sum, item) => sum + item.attempts, 0) /
            Math.max(fixtureResults.length, 1)
          ).toFixed(2),
        ),
        parsedMetaCount: fixtureResults.filter((item) => item.parsedMeta).length,
        missingPrimaryCount: fixtureResults.filter((item) => item.missingPrimary).length,
        rawContaminatedCount: fixtureResults.filter((item) => item.rawContaminated).length,
        fixtures: fixtureResults,
      });
    }

    await unloadModel(baseUrl, model).catch(() => undefined);
  }

  writeFileSync(
    outputPath,
    JSON.stringify(
      {
        endpoint: baseUrl,
        fixturePath,
        perPair,
        models,
        profiles: requestedProfiles,
        results,
      },
      null,
      2,
    ),
  );

  for (const summary of results) {
    console.log(
      `${summary.model} / ${summary.profile}: usableRate=${summary.usableRate} avgAttempts=${summary.avgAttempts} parsedMeta=${summary.parsedMetaCount} missingPrimary=${summary.missingPrimaryCount}`,
    );
  }
  console.log(`Wrote ${outputPath}`);
}

void main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
