import { aiStore } from '@/services/ai/storage/aiStore';
import type { BookDocType } from '@/services/ai/ragService';
import { extractTextFromDocument } from '@/services/ai/utils/chunker';

export interface MineCorpusExamplesInput {
  bookKey: string;
  bookHash: string;
  bookDoc?: BookDocType | null;
  term: string;
  baseForm?: string | null;
  topN?: number;
  maxPage?: number;
  localPastContext?: string;
  localFutureBuffer?: string;
}

type RankedSentence = {
  sentence: string;
  score: number;
};

class LRUCache<K, V> {
  private readonly map = new Map<K, V>();

  constructor(private readonly maxSize: number) {}

  get(key: K): V | undefined {
    if (!this.map.has(key)) return undefined;
    const value = this.map.get(key)!;
    this.map.delete(key);
    this.map.set(key, value); // promote to MRU
    return value;
  }

  set(key: K, value: V): void {
    if (this.map.has(key)) this.map.delete(key);
    if (this.map.size >= this.maxSize) {
      // evict LRU (first inserted)
      this.map.delete(this.map.keys().next().value!);
    }
    this.map.set(key, value);
  }
}

const wholeBookCache = new LRUCache<string, RankedSentence[]>(5);

function normalizeText(value: string): string {
  return value.trim().toLocaleLowerCase();
}

function splitIntoSentences(text: string): string[] {
  return (text.match(/[^.!?。！？\n]+[.!?。！？]?/gu) ?? [text])
    .map((sentence) => sentence.trim())
    .filter(Boolean);
}

function buildLiteralSet(term: string, baseForm?: string | null): string[] {
  const literals = new Set<string>();
  const normalizedTerm = normalizeText(term);
  if (normalizedTerm) {
    literals.add(normalizedTerm);
  }

  const normalizedBaseForm = normalizeText(baseForm ?? '');
  if (normalizedBaseForm) {
    literals.add(normalizedBaseForm);
  }

  return [...literals];
}

function sentenceCentralityScore(sentence: string, literals: string[]): number {
  const normalized = normalizeText(sentence);
  if (!normalized) return Number.NEGATIVE_INFINITY;

  let bestScore = Number.NEGATIVE_INFINITY;
  const center = normalized.length / 2;

  for (const literal of literals) {
    if (!literal) continue;
    let index = normalized.indexOf(literal);
    while (index !== -1) {
      const matchCenter = index + literal.length / 2;
      const distance = Math.abs(matchCenter - center);
      const score = 1 - distance / (center + 1);
      if (score > bestScore) {
        bestScore = score;
      }
      index = normalized.indexOf(literal, index + literal.length);
    }
  }

  return bestScore;
}

function rankSentences(sentences: string[], literals: string[]): RankedSentence[] {
  const ranked: RankedSentence[] = [];

  for (const sentence of sentences) {
    const score = sentenceCentralityScore(sentence, literals);
    if (score === Number.NEGATIVE_INFINITY) continue;
    ranked.push({ sentence, score });
  }

  ranked.sort((a, b) => b.score - a.score);

  const seen = new Set<string>();
  return ranked.filter((entry) => {
    const key = normalizeText(entry.sentence);
    if (!key || seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

function collectMatchingSentences(text: string, literals: string[]): RankedSentence[] {
  if (!text.trim() || literals.length === 0) return [];
  return rankSentences(splitIntoSentences(text), literals).filter((entry) => {
    const normalizedSentence = normalizeText(entry.sentence);
    return literals.some((literal) => normalizedSentence.includes(literal));
  });
}

function toExampleList(entries: RankedSentence[], topN: number): string[] {
  return entries.slice(0, topN).map((entry) => entry.sentence);
}

async function mineFromIndexedChunks(
  bookHash: string,
  literals: string[],
  topN: number,
  maxPage?: number,
): Promise<string[]> {
  const chunks = await aiStore.getChunks(bookHash);
  const matchingSentences: string[] = [];

  for (const chunk of chunks) {
    if (maxPage !== undefined && chunk.pageNumber > maxPage) continue;
    const sentences = splitIntoSentences(chunk.text).filter((sentence) => {
      const normalizedSentence = normalizeText(sentence);
      return literals.some((literal) => normalizedSentence.includes(literal));
    });
    matchingSentences.push(...sentences);
  }

  return toExampleList(rankSentences(matchingSentences, literals), topN);
}

async function mineFromWholeBook(
  bookDoc: BookDocType,
  cacheKey: string,
  literals: string[],
  topN: number,
): Promise<string[]> {
  const cached = wholeBookCache.get(cacheKey);
  if (cached) {
    return toExampleList(cached, topN);
  }

  const combinedTextParts: string[] = [];

  for (const section of bookDoc.sections ?? []) {
    try {
      const document = await section.createDocument();
      const text = extractTextFromDocument(document);
      if (text.trim()) {
        combinedTextParts.push(text);
      }
    } catch {
      // Ignore section-level extraction failures and continue scanning the book.
    }
  }

  const ranked = collectMatchingSentences(combinedTextParts.join('\n'), literals);
  wholeBookCache.set(cacheKey, ranked);

  return toExampleList(ranked, topN);
}

function mineFromLocalBuffers(
  literals: string[],
  topN: number,
  localPastContext?: string,
  localFutureBuffer?: string,
): string[] {
  const localBuffer = `${localPastContext ?? ''}\n${localFutureBuffer ?? ''}`.trim();
  if (!localBuffer) return [];
  return toExampleList(collectMatchingSentences(localBuffer, literals), topN);
}

export async function mineCorpusExamples({
  bookHash,
  bookDoc,
  term,
  baseForm,
  topN = 2,
  maxPage,
  localPastContext,
  localFutureBuffer,
}: MineCorpusExamplesInput): Promise<string[]> {
  const literals = buildLiteralSet(term, baseForm);
  if (literals.length === 0) return [];

  try {
    if (await aiStore.isIndexed(bookHash)) {
      const indexedExamples = await mineFromIndexedChunks(bookHash, literals, topN, maxPage);
      if (indexedExamples.length > 0) {
        return indexedExamples;
      }
    }
  } catch {
    // Fall through to the whole-book scan path.
  }

  if (bookDoc?.sections?.length) {
    const cacheKey = `${bookHash}:${literals.join('|')}`;
    const wholeBookExamples = await mineFromWholeBook(bookDoc, cacheKey, literals, topN);
    if (wholeBookExamples.length > 0) {
      return wholeBookExamples;
    }
  }

  return mineFromLocalBuffers(literals, topN, localPastContext, localFutureBuffer);
}
