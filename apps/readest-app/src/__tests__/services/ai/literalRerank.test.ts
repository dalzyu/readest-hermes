import { beforeEach, describe, expect, test, vi } from 'vitest';

const { mockGetDictionaryForm } = vi.hoisted(() => ({
  mockGetDictionaryForm: vi.fn((value: string) => value),
}));

vi.mock('@/services/contextTranslation/plugins/jpTokenizer', () => ({
  getDictionaryForm: (value: string) => mockGetDictionaryForm(value),
}));

import { rerankByLiteralMatch } from '@/services/ai/utils/literalRerank';

type Chunk = {
  id: string;
  text: string;
  score: number;
  searchMethod: string;
};

const makeChunks = (): Chunk[] => [
  {
    id: '1',
    text: 'The trusted companion stayed close by his side.',
    score: 0.4,
    searchMethod: 'vector',
  },
  {
    id: '2',
    text: 'A distant sentence without the target.',
    score: 0.5,
    searchMethod: 'vector',
  },
];

describe('rerankByLiteralMatch', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockGetDictionaryForm.mockImplementation((value: string) => value);
  });

  test('boosts chunks containing the literal term', async () => {
    const reranked = await rerankByLiteralMatch(makeChunks(), 'companion');

    expect(reranked[0]?.id).toBe('1');
    expect(reranked[0]?.score).toBeCloseTo(0.65);
    expect(reranked[0]?.searchMethod).toBe('reranked');
    expect(reranked[1]?.searchMethod).toBe('reranked');
  });

  test('keeps ordering by score when no chunk matches', async () => {
    const reranked = await rerankByLiteralMatch(makeChunks(), 'nonexistent');

    expect(reranked.map((chunk) => chunk.id)).toEqual(['2', '1']);
    expect(reranked[0]?.score).toBe(0.5);
    expect(reranked[1]?.score).toBe(0.4);
  });

  test('uses Japanese dictionary form when surface form does not match', async () => {
    mockGetDictionaryForm.mockReturnValue('食べる');

    const reranked = await rerankByLiteralMatch(
      [
        {
          id: 'jp-1',
          text: '彼は毎晩ここで食べる。',
          score: 0.3,
          searchMethod: 'vector',
        },
        {
          id: 'jp-2',
          text: '彼は眠る。',
          score: 0.4,
          searchMethod: 'vector',
        },
      ],
      '食べた',
    );

    expect(mockGetDictionaryForm).toHaveBeenCalledWith('食べた');
    expect(reranked[0]?.id).toBe('jp-1');
    expect(reranked[0]?.score).toBeCloseTo(0.55);
  });

  test('returns the original array when term is empty', async () => {
    const chunks = makeChunks();
    const reranked = await rerankByLiteralMatch(chunks, '   ');

    expect(reranked).toBe(chunks);
  });
});
