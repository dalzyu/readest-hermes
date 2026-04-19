import { embed, embedMany } from 'ai';
import { aiStore } from './storage/aiStore';
import { chunkSection, extractTextFromDocument } from './utils/chunker';
import { withRetryAndTimeout, AI_TIMEOUTS, AI_RETRY_CONFIGS } from './utils/retry';
import { getProviderForTask } from './providers';
import { resolveEmbeddingModelId } from './constants';
import { aiLogger } from './logger';
import { rerankByLiteralMatch } from './utils/literalRerank';
import type {
  AISettings,
  TextChunk,
  ScoredChunk,
  EmbeddingProgress,
  BookIndexMeta,
  IndexResult,
} from './types';
import type { PageSearchBounds } from './storage/aiStore';

interface SectionItem {
  id: string;
  size: number;
  linear: string;
  createDocument: () => Promise<Document>;
}

interface TOCItem {
  id: number;
  label: string;
  href?: string;
}

function getEmbeddingBatchSize(model: unknown): number {
  const configuredBatchSize =
    typeof model === 'object' &&
    model !== null &&
    'maxEmbeddingsPerCall' in model &&
    typeof model.maxEmbeddingsPerCall === 'number' &&
    model.maxEmbeddingsPerCall > 0
      ? model.maxEmbeddingsPerCall
      : 100;

  return Math.max(1, configuredBatchSize);
}

type LocalizedText = Record<string, string>;
type ContributorMetadata = { name?: string | LocalizedText };

export interface BookDocType {
  sections?: SectionItem[];
  toc?: TOCItem[];
  metadata?: {
    title?: string | LocalizedText;
    author?: string | ContributorMetadata | LocalizedText;
  };
}

function resolveLocalizedText(value?: string | LocalizedText): string | undefined {
  if (!value) return undefined;
  if (typeof value === 'string') return value;
  return value['en'] || value['default'] || Object.values(value)[0];
}

const indexingStates = new Map<string, IndexingState>();
const cancelledBookIndexes = new Set<string>();

interface QueryEmbeddingCacheEntry {
  providerModel: string;
  embedding: number[];
  cachedAt: number;
}

const QUERY_EMBEDDING_CACHE_TTL_MS = 5 * 60 * 1000;
const queryEmbeddingCache = new Map<string, QueryEmbeddingCacheEntry>();

function normalizeEmbeddingCacheKey(query: string): string {
  return query.trim().toLocaleLowerCase();
}

function getCachedEmbedding(query: string, providerModel: string): number[] | null {
  const key = normalizeEmbeddingCacheKey(query);
  if (!key) return null;

  const cached = queryEmbeddingCache.get(key);
  if (!cached) return null;
  if (cached.providerModel !== providerModel) return null;

  if (Date.now() - cached.cachedAt > QUERY_EMBEDDING_CACHE_TTL_MS) {
    queryEmbeddingCache.delete(key);
    return null;
  }

  return cached.embedding;
}

function setCachedEmbedding(query: string, embedding: number[], providerModel: string): void {
  const key = normalizeEmbeddingCacheKey(query);
  if (!key) return;
  queryEmbeddingCache.set(key, { providerModel, embedding, cachedAt: Date.now() });
}

function assertIndexingNotCancelled(bookHash: string): void {
  if (!cancelledBookIndexes.has(bookHash)) return;
  cancelledBookIndexes.delete(bookHash);
  throw new Error('Indexing cancelled');
}

export function cancelBookIndexing(bookHash: string): void {
  cancelledBookIndexes.add(bookHash);
}

export async function isBookIndexed(bookHash: string): Promise<boolean> {
  const indexed = await aiStore.isIndexed(bookHash);
  aiLogger.rag.isIndexed(bookHash, indexed);
  return indexed;
}

function extractTitle(metadata?: BookDocType['metadata']): string {
  return resolveLocalizedText(metadata?.title) ?? 'Unknown Book';
}

function extractAuthor(metadata?: BookDocType['metadata']): string {
  if (!metadata?.author) return 'Unknown Author';
  if (typeof metadata.author === 'string') return metadata.author;

  const contributorName =
    typeof metadata.author === 'object' && metadata.author !== null && 'name' in metadata.author
      ? (metadata.author as ContributorMetadata).name
      : undefined;
  const authorAsLocalized = metadata.author as LocalizedText;
  return (
    resolveLocalizedText(contributorName) ??
    resolveLocalizedText(authorAsLocalized) ??
    'Unknown Author'
  );
}

function getChapterTitle(toc: TOCItem[] | undefined, sectionIndex: number): string {
  if (!toc || toc.length === 0) return `Section ${sectionIndex + 1}`;
  for (let i = toc.length - 1; i >= 0; i--) {
    if (toc[i]!.id <= sectionIndex) return toc[i]!.label;
  }
  return toc[0]?.label || `Section ${sectionIndex + 1}`;
}

export async function indexBook(
  bookDoc: BookDocType,
  bookHash: string,
  settings: AISettings,
  onProgress?: (progress: EmbeddingProgress) => void,
): Promise<IndexResult> {
  const startTime = Date.now();
  const title = extractTitle(bookDoc.metadata);
  cancelledBookIndexes.delete(bookHash);

  if (await aiStore.isIndexed(bookHash)) {
    aiLogger.rag.isIndexed(bookHash, true);
    return {
      status: 'already-indexed',
      chunksProcessed: 0,
      totalSections: 0,
      skippedSections: 0,
      errorMessages: [],
      durationMs: 0,
    };
  }

  aiLogger.rag.indexStart(bookHash, title);
  const { provider, modelId, config } = getProviderForTask(settings, 'embedding');
  const sections = bookDoc.sections || [];
  const toc = bookDoc.toc || [];

  // calculate cumulative character sizes like toc.ts does
  const sizes = sections.map((s) => (s.linear !== 'no' && s.size > 0 ? s.size : 0));
  let cumulative = 0;
  const cumulativeSizes = sizes.map((size) => {
    const current = cumulative;
    cumulative += size;
    return current;
  });

  const state: IndexingState = {
    bookHash,
    status: 'indexing',
    progress: 0,
    chunksProcessed: 0,
    totalChunks: 0,
  };
  indexingStates.set(bookHash, state);

  try {
    onProgress?.({ current: 0, total: 1, phase: 'chunking' });
    assertIndexingNotCancelled(bookHash);
    aiLogger.rag.indexProgress('chunking', 0, sections.length);
    const allChunks: TextChunk[] = [];
    let skippedCount = 0;
    const errorMessages: string[] = [];

    for (let i = 0; i < sections.length; i++) {
      assertIndexingNotCancelled(bookHash);
      const section = sections[i]!;
      try {
        const doc = await section.createDocument();
        const text = extractTextFromDocument(doc);
        if (text.length < 100) {
          skippedCount++;
          continue;
        }
        const sectionChunks = chunkSection(
          doc,
          i,
          getChapterTitle(toc, i),
          bookHash,
          cumulativeSizes[i] ?? 0,
        );
        aiLogger.chunker.section(i, text.length, sectionChunks.length);
        allChunks.push(...sectionChunks);
      } catch (e) {
        const msg = (e as Error).message;
        aiLogger.chunker.error(i, msg);
        errorMessages.push(`Section ${i}: ${msg}`);
      }
    }

    aiLogger.chunker.complete(bookHash, allChunks.length);
    state.totalChunks = allChunks.length;

    if (allChunks.length === 0) {
      const durationMs = Date.now() - startTime;
      state.status = 'complete';
      state.progress = 100;
      aiLogger.rag.indexComplete(bookHash, 0, durationMs);
      return {
        status: 'empty',
        chunksProcessed: 0,
        totalSections: sections.length,
        skippedSections: skippedCount,
        errorMessages,
        durationMs,
      };
    }

    onProgress?.({ current: 0, total: allChunks.length, phase: 'embedding' });
    const embeddingModelName = resolveEmbeddingModelId(config) || 'unknown';
    aiLogger.embedding.start(embeddingModelName, allChunks.length);

    const embeddingModel = provider.getEmbeddingModel(modelId);
    const texts = allChunks.map((c) => c.text);
    const batchSize = getEmbeddingBatchSize(embeddingModel);
    try {
      let embeddedCount = 0;
      let embeddingDimensions = 0;

      assertIndexingNotCancelled(bookHash);
      for (let batchStart = 0; batchStart < texts.length; batchStart += batchSize) {
        const batchTexts = texts.slice(batchStart, batchStart + batchSize);
        const { embeddings } = await withRetryAndTimeout(
          () =>
            embedMany({
              model: embeddingModel,
              values: batchTexts,
            }),
          AI_TIMEOUTS.EMBEDDING_BATCH,
          AI_RETRY_CONFIGS.EMBEDDING,
        );

        embeddingDimensions ||= embeddings[0]?.length || 0;

        for (let i = 0; i < embeddings.length; i++) {
          allChunks[batchStart + i]!.embedding = embeddings[i];
        }

        embeddedCount += embeddings.length;
        state.chunksProcessed = embeddedCount;
        state.progress = Math.round((embeddedCount / allChunks.length) * 100);
        onProgress?.({ current: embeddedCount, total: allChunks.length, phase: 'embedding' });
        aiLogger.embedding.batch(embeddedCount, allChunks.length);
      }

      aiLogger.embedding.complete(embeddedCount, allChunks.length, embeddingDimensions);
    } catch (e) {
      aiLogger.embedding.error('batch', (e as Error).message);
      throw e;
    }

    assertIndexingNotCancelled(bookHash);
    onProgress?.({ current: 1, total: 1, phase: 'finalizing' });
    aiLogger.rag.indexProgress('finalizing', 1, 1);
    aiLogger.store.saveChunks(bookHash, allChunks.length);
    await aiStore.saveChunks(allChunks);

    const meta: BookIndexMeta = {
      bookHash,
      bookTitle: title,
      authorName: extractAuthor(bookDoc.metadata),
      totalSections: sections.length,
      totalChunks: allChunks.length,
      embeddingModel: embeddingModelName,
      lastUpdated: Date.now(),
    };
    aiLogger.store.saveMeta(meta);
    await aiStore.saveMeta(meta);
    state.status = 'complete';
    state.progress = 100;
    const durationMs = Date.now() - startTime;
    aiLogger.rag.indexComplete(bookHash, allChunks.length, durationMs);
    const status = errorMessages.length > 0 ? 'partial' : 'complete';
    return {
      status,
      chunksProcessed: allChunks.length,
      totalSections: sections.length,
      skippedSections: skippedCount,
      errorMessages,
      durationMs,
    };
  } catch (error) {
    state.status = 'error';
    state.error = (error as Error).message;
    aiLogger.rag.indexError(bookHash, (error as Error).message);
    throw error;
  } finally {
    cancelledBookIndexes.delete(bookHash);
  }
}

export async function vectorSearch(
  bookHash: string,
  query: string,
  settings: AISettings,
  topK = 10,
  bounds?: number | PageSearchBounds,
  rerankTerm?: string,
): Promise<ScoredChunk[]> {
  const normalizedBounds = typeof bounds === 'number' ? { maxPage: bounds } : bounds;
  aiLogger.search.query(query, normalizedBounds?.maxPage);
  const { provider, modelId } = getProviderForTask(settings, 'embedding');
  const providerModelKey = `${provider.id}:${modelId}`;

  const queryEmbedding = await (async (): Promise<number[] | null> => {
    try {
      const cached = getCachedEmbedding(query, providerModelKey);
      if (cached) {
        return cached;
      }

      const { embedding } = await withRetryAndTimeout(
        () =>
          embed({
            model: provider.getEmbeddingModel(modelId),
            value: query,
          }),
        AI_TIMEOUTS.EMBEDDING_SINGLE,
        AI_RETRY_CONFIGS.EMBEDDING,
      );
      setCachedEmbedding(query, embedding, providerModelKey);
      return embedding;
    } catch {
      return null;
    }
  })();

  if (!queryEmbedding) {
    return [];
  }

  const vectorTopK = Math.max(topK * 2, topK);
  const vectorResults = await aiStore.vectorSearch(bookHash, queryEmbedding, vectorTopK, bounds);
  const rerankedResults = await rerankByLiteralMatch(vectorResults, rerankTerm ?? query);
  const results = rerankedResults.slice(0, topK);

  if (results.length > 0) {
    aiLogger.search.rerankedResults(results.length, results[0]!.score);
  }

  return results;
}

export async function clearBookIndex(bookHash: string): Promise<void> {
  aiLogger.store.clear(bookHash);
  await aiStore.clearBook(bookHash);
  indexingStates.delete(bookHash);
}

// internal type for indexing state tracking
interface IndexingState {
  bookHash: string;
  status: 'idle' | 'indexing' | 'complete' | 'error';
  progress: number;
  chunksProcessed: number;
  totalChunks: number;
  error?: string;
}
