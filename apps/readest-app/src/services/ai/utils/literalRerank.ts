import { getCJKLanguage } from '@/services/contextTranslation/utils';

interface RerankChunk {
  text: string;
  score: number;
  searchMethod?: string;
}

export interface LiteralRerankOptions {
  boost?: number;
  pageContext?: string;
  bookLanguage?: string;
}

const DEFAULT_LITERAL_BOOST = 0.25;

function normalizeLiteral(value: string): string {
  return value.trim().toLocaleLowerCase();
}

function includesLiteral(text: string, literals: string[]): boolean {
  if (!text) return false;
  const normalizedText = normalizeLiteral(text);
  return literals.some((literal) => literal.length > 0 && normalizedText.includes(literal));
}

async function getJapaneseDictionaryForm(term: string): Promise<string | null> {
  try {
    const { getDictionaryForm } = await import('@/services/contextTranslation/plugins/jpTokenizer');
    const dictionaryForm = getDictionaryForm(term);
    const normalized = normalizeLiteral(dictionaryForm);
    if (!normalized || normalized === normalizeLiteral(term)) {
      return null;
    }
    return normalized;
  } catch {
    return null;
  }
}

async function resolveLiterals(term: string, options?: LiteralRerankOptions): Promise<string[]> {
  const normalizedTerm = normalizeLiteral(term);
  if (!normalizedTerm) return [];

  const literals = new Set<string>([normalizedTerm]);
  const cjkLanguage = getCJKLanguage(term, options?.pageContext ?? '', options?.bookLanguage);

  if (cjkLanguage === 'japanese') {
    const dictionaryForm = await getJapaneseDictionaryForm(term);
    if (dictionaryForm) {
      literals.add(dictionaryForm);
    }
  }

  return [...literals];
}

export async function rerankByLiteralMatch<T extends RerankChunk>(
  chunks: T[],
  term: string,
  options?: LiteralRerankOptions,
): Promise<T[]> {
  if (!term.trim()) {
    return chunks;
  }

  const boost = options?.boost ?? DEFAULT_LITERAL_BOOST;
  const literals = await resolveLiterals(term, options);
  if (literals.length === 0) {
    return chunks;
  }

  return chunks
    .map((chunk) => {
      const matched = includesLiteral(chunk.text, literals);
      if (!matched) {
        return {
          ...chunk,
          searchMethod: 'reranked' satisfies string as T['searchMethod'],
        };
      }

      return {
        ...chunk,
        score: chunk.score + boost,
        searchMethod: 'reranked' satisfies string as T['searchMethod'],
      };
    })
    .sort((a, b) => b.score - a.score);
}
