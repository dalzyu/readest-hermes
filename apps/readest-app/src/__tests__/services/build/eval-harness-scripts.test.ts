import { describe, expect, test } from 'vitest';

import type { PromptTestFixture } from '@/services/contextTranslation/promptTestHarness';
import {
  collectWeakClusterPairs,
  freezeWeakClusterFixtures,
  mapWithConcurrency,
  retryWithBackoff,
  sampleFixturesByPair,
  selectTranslationModels,
} from '../../../../scripts/eval/evalHarnessUtils';
import {
  parsedFieldsLookContaminated,
  responseLooksContaminated,
} from '../../../../scripts/eval/productionTranslationEval';

function summarizeLikeScript(
  results: Array<{ scores?: Record<string, number>; attemptCount?: number; structuralFlags?: Record<string, boolean> }>,
  averageLatencyMs: number,
) {
  const usabilityScores = results
    .map((result) => result.scores?.['usability'])
    .filter((score): score is number => typeof score === 'number');
  const structuralUsability = results.map((result) =>
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
        : structuralUsability.reduce<number>((sum, score) => sum + score, 0) /
          Math.max(structuralUsability.length, 1))
    ).toFixed(3),
  );

  return {
    total: results.length,
    usableCases,
    usableRate: Number((usableCases / Math.max(results.length, 1)).toFixed(3)),
    avgUsability,
    avgAttempts: Number(
      (
        results.reduce((sum, result) => sum + (result.attemptCount ?? 1), 0) /
        Math.max(results.length, 1)
      ).toFixed(2),
    ),
    avgLatencyMs: averageLatencyMs,
    parsedMetaCount: results.filter((result) => result.structuralFlags?.['parsedMeta']).length,
    missingPrimaryCount: results.filter((result) => result.structuralFlags?.['missingPrimary'])
      .length,
    rawContaminatedCount: results.filter(
      (result) => result.structuralFlags?.['rawContaminated'],
    ).length,
  };
}

const fixture = (
  id: string,
  sourceLanguage: string,
  targetLanguage: string,
): PromptTestFixture => ({
  id,
  sourceText: id,
  sourceLanguage,
  targetLanguage,
  bookContext: id,
});

describe('eval harness script helpers', () => {
  test('selectTranslationModels excludes judge-only and embedding models', () => {
    const selection = selectTranslationModels(
      [
        { id: 'Qwen3.5-0.8B-UD-Q6_K_XL' },
        { id: 'Qwen3.5-4B-Q4_K_M' },
        { id: 'gemma-4-E2B-it-Q4_K_M' },
        { id: 'gemma-4-26B-A4B-it-MXFP4_MOE' },
        { id: 'ggml-org/embeddinggemma-300M-GGUF:Q8_0' },
      ],
      ['Qwen3.5-0.8B-UD-Q6_K_XL', 'gemma-4-26B-A4B-it-MXFP4_MOE', 'missing-model'],
    );

    expect(selection.activeModels).toEqual(['Qwen3.5-0.8B-UD-Q6_K_XL']);
    expect(selection.missingModels).toEqual(['missing-model']);
    expect(selection.excludedModels).toEqual([
      'gemma-4-26B-A4B-it-MXFP4_MOE',
      'ggml-org/embeddinggemma-300M-GGUF:Q8_0',
    ]);
  });

  test('collectWeakClusterPairs expands wildcards and deduplicates exact pairs', () => {
    const pairs = collectWeakClusterPairs([
      fixture('en-de-000', 'en', 'de'),
      fixture('en-es-000', 'en', 'es'),
      fixture('fr-de-000', 'fr', 'de'),
      fixture('pt-de-000', 'pt', 'de'),
      fixture('ko-ru-000', 'ko', 'ru'),
      fixture('it-hi-000', 'it', 'hi'),
      fixture('hi-zh-000', 'hi', 'zh'),
      fixture('hi-fr-000', 'hi', 'fr'),
      fixture('ja-en-000', 'ja', 'en'),
    ]);

    expect(pairs).toEqual([
      'en->de',
      'en->es',
      'en->hi',
      'en->it',
      'en->pt',
      'fr->de',
      'hi->fr',
      'hi->zh',
      'it->hi',
      'ko->ru',
      'pt->de',
    ]);
  });

  test('freezeWeakClusterFixtures keeps the first fixtures per targeted pair in stable order', () => {
    const fixtures = [
      fixture('en-de-000', 'en', 'de'),
      fixture('en-de-001', 'en', 'de'),
      fixture('en-de-002', 'en', 'de'),
      fixture('fr-ru-000', 'fr', 'ru'),
      fixture('fr-ru-001', 'fr', 'ru'),
      fixture('ja-en-000', 'ja', 'en'),
    ];

    expect(freezeWeakClusterFixtures(fixtures, ['en->de', 'fr->ru'], 2).map((item) => item.id)).toEqual([
      'en-de-000',
      'en-de-001',
      'fr-ru-000',
      'fr-ru-001',
    ]);
  });

  test('sampleFixturesByPair caps each pair independently', () => {
    const fixtures = [
      fixture('en-de-000', 'en', 'de'),
      fixture('en-de-001', 'en', 'de'),
      fixture('en-de-002', 'en', 'de'),
      fixture('fr-ru-000', 'fr', 'ru'),
      fixture('fr-ru-001', 'fr', 'ru'),
    ];

    expect(sampleFixturesByPair(fixtures, 2).map((item) => item.id)).toEqual([
      'en-de-000',
      'en-de-001',
      'fr-ru-000',
      'fr-ru-001',
    ]);
  });

  test('mapWithConcurrency preserves input order while limiting active work', async () => {
    const active = { current: 0, peak: 0 };

    const result = await mapWithConcurrency([1, 2, 3, 4, 5], 2, async (value) => {
      active.current += 1;
      active.peak = Math.max(active.peak, active.current);
      await new Promise((resolve) => setTimeout(resolve, value % 2 === 0 ? 20 : 10));
      active.current -= 1;
      return value * 10;
    });

    expect(result).toEqual([10, 20, 30, 40, 50]);
    expect(active.peak).toBe(2);
  });

  test('retryWithBackoff retries transient failures and returns the eventual result', async () => {
    let attempts = 0;

    const result = await retryWithBackoff(
      async () => {
        attempts += 1;
        if (attempts < 3) {
          throw new Error('transient');
        }
        return 'ok';
      },
      {
        retries: 2,
        delaysMs: [1, 1],
        shouldRetry: (error) => error instanceof Error && error.message === 'transient',
      },
    );

    expect(result).toBe('ok');
    expect(attempts).toBe(3);
  });

  test('responseLooksContaminated detects reasoning markers in raw model output', () => {
    expect(responseLooksContaminated('Thinking Process:\n1. Analyze the Request.')).toBe(true);
    expect(responseLooksContaminated('Confidence Score: 5/5')).toBe(true);
    expect(responseLooksContaminated('<translation>bonjour</translation>')).toBe(false);
  });

  test('parsedFieldsLookContaminated catches surviving meta structure in parsed fields', () => {
    expect(
      parsedFieldsLookContaminated({
        translation: 'bonjour',
        contextualMeaning: '* Selected word: hello',
      }),
    ).toBe(true);

    expect(
      parsedFieldsLookContaminated({
        translation: 'bonjour',
        contextualMeaning: 'Salutation simple et naturelle.',
      }),
    ).toBe(false);
  });

  test('production summary falls back to structural usability when prompt scores are absent', () => {
    const summary = summarizeLikeScript(
      [
        {
          attemptCount: 1,
          structuralFlags: {
            parsedMeta: false,
            missingPrimary: false,
            rawContaminated: false,
          },
        },
        {
          attemptCount: 2,
          structuralFlags: {
            parsedMeta: true,
            missingPrimary: false,
            rawContaminated: true,
          },
        },
      ],
      123,
    );

    expect(summary.usableCases).toBe(1);
    expect(summary.usableRate).toBe(0.5);
    expect(summary.avgUsability).toBe(0.5);
    expect(summary.avgAttempts).toBe(1.5);
    expect(summary.parsedMetaCount).toBe(1);
    expect(summary.rawContaminatedCount).toBe(1);
  });
});
