import type { PromptTestFixture } from '@/services/contextTranslation/promptTestHarness';

type InventoryModel = {
  id: string;
};

export const JUDGE_MODEL_ID = 'gemma-4-26B-A4B-it-MXFP4_MOE';

const EXPLICIT_BASE_PAIRS = [
  'en->hi',
  'en->de',
  'en->it',
  'en->pt',
  'en->es',
  'pt->de',
  'ko->ru',
  'it->hi',
] as const;

export function getFixturePair(fixture: Pick<PromptTestFixture, 'sourceLanguage' | 'targetLanguage'>): string {
  return `${fixture.sourceLanguage}->${fixture.targetLanguage}`;
}

export function isEmbeddingModel(modelId: string): boolean {
  return modelId.toLowerCase().includes('embedding');
}

export function isJudgeOnlyModel(modelId: string): boolean {
  return modelId === JUDGE_MODEL_ID;
}

export function isTranslationModel(modelId: string): boolean {
  return !isEmbeddingModel(modelId) && !isJudgeOnlyModel(modelId);
}

export function selectTranslationModels(
  availableModels: InventoryModel[],
  requestedModels?: string[],
): {
  activeModels: string[];
  missingModels: string[];
  excludedModels: string[];
} {
  const availableIds = new Set(availableModels.map((model) => model.id));
  const excludedModels = availableModels
    .map((model) => model.id)
    .filter((modelId) => !isTranslationModel(modelId))
    .sort();
  const translationIds = availableModels
    .map((model) => model.id)
    .filter((modelId) => isTranslationModel(modelId));

  if (!requestedModels || requestedModels.length === 0) {
    return {
      activeModels: translationIds,
      missingModels: [],
      excludedModels,
    };
  }

  const activeModels = requestedModels.filter(
    (modelId) => availableIds.has(modelId) && isTranslationModel(modelId),
  );
  const missingModels = requestedModels.filter((modelId) => !availableIds.has(modelId));

  return {
    activeModels,
    missingModels,
    excludedModels,
  };
}

export function sampleFixturesByPair(fixtures: PromptTestFixture[], perPair: number): PromptTestFixture[] {
  const byPair = new Map<string, PromptTestFixture[]>();

  for (const fixture of fixtures) {
    const key = getFixturePair(fixture);
    const items = byPair.get(key);
    if (items) {
      items.push(fixture);
      continue;
    }

    byPair.set(key, [fixture]);
  }

  const sampled: PromptTestFixture[] = [];
  for (const items of byPair.values()) {
    sampled.push(...items.slice(0, perPair));
  }

  return sampled;
}

export function collectWeakClusterPairs(fixtures: PromptTestFixture[]): string[] {
  const pairs = new Set<string>(EXPLICIT_BASE_PAIRS);

  for (const fixture of fixtures) {
    const pair = getFixturePair(fixture);
    if (
      fixture.sourceLanguage === 'hi' ||
      fixture.targetLanguage === 'de' ||
      fixture.targetLanguage === 'ru' ||
      pairs.has(pair)
    ) {
      pairs.add(pair);
    }
  }

  return [...pairs].sort();
}

export function freezeWeakClusterFixtures(
  fixtures: PromptTestFixture[],
  pairs: readonly string[],
  perPair: number,
): PromptTestFixture[] {
  const pairSet = new Set(pairs);
  return sampleFixturesByPair(
    fixtures.filter((fixture) => pairSet.has(getFixturePair(fixture))),
    perPair,
  );
}

export async function mapWithConcurrency<T, R>(
  items: readonly T[],
  concurrency: number,
  mapper: (item: T, index: number) => Promise<R>,
): Promise<R[]> {
  const limit = Math.max(1, Math.floor(concurrency));
  const results = new Array<R>(items.length);
  let nextIndex = 0;

  async function worker(): Promise<void> {
    while (true) {
      const currentIndex = nextIndex;
      nextIndex += 1;

      if (currentIndex >= items.length) {
        return;
      }

      results[currentIndex] = await mapper(items[currentIndex] as T, currentIndex);
    }
  }

  const workers = Array.from({ length: Math.min(limit, items.length) }, () => worker());
  await Promise.all(workers);
  return results;
}

export async function retryWithBackoff<T>(
  operation: () => Promise<T>,
  options?: {
    retries?: number;
    delaysMs?: number[];
    shouldRetry?: (error: unknown) => boolean;
  },
): Promise<T> {
  const retries = Math.max(0, options?.retries ?? 0);
  const delaysMs = options?.delaysMs ?? [];
  const shouldRetry = options?.shouldRetry ?? (() => true);
  let lastError: unknown;

  for (let attempt = 0; attempt <= retries; attempt += 1) {
    try {
      return await operation();
    } catch (error) {
      lastError = error;
      if (attempt >= retries || !shouldRetry(error)) {
        throw error;
      }

      const delay = delaysMs[attempt] ?? delaysMs[delaysMs.length - 1] ?? 0;
      if (delay > 0) {
        await new Promise((resolve) => setTimeout(resolve, delay));
      }
    }
  }

  throw lastError instanceof Error ? lastError : new Error(String(lastError));
}
