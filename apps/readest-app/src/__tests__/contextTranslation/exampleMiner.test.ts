import { beforeEach, describe, expect, test, vi } from 'vitest';

const { mockIsIndexed, mockGetChunks, mockExtractTextFromDocument } = vi.hoisted(() => ({
  mockIsIndexed: vi.fn(),
  mockGetChunks: vi.fn(),
  mockExtractTextFromDocument: vi.fn(),
}));

vi.mock('@/services/ai/storage/aiStore', () => ({
  aiStore: {
    isIndexed: (bookHash: string) => mockIsIndexed(bookHash),
    getChunks: (bookHash: string) => mockGetChunks(bookHash),
  },
}));

vi.mock('@/services/ai/utils/chunker', () => ({
  extractTextFromDocument: (doc: Document) => mockExtractTextFromDocument(doc),
}));

import { mineCorpusExamples } from '@/services/contextTranslation/exampleMiner';
import type { BookDocType } from '@/services/ai/ragService';

describe('mineCorpusExamples', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  test('uses indexed chunks when the book is indexed', async () => {
    mockIsIndexed.mockResolvedValue(true);
    mockGetChunks.mockResolvedValue([
      {
        id: 'chunk-1',
        bookHash: 'book-hash',
        sectionIndex: 0,
        chapterTitle: 'Chapter 1',
        text: 'He stayed by her side. Another sentence.',
        pageNumber: 1,
      },
      {
        id: 'chunk-2',
        bookHash: 'book-hash',
        sectionIndex: 1,
        chapterTitle: 'Chapter 2',
        text: 'A side remark appears again near the center of this sentence.',
        pageNumber: 2,
      },
    ]);

    const examples = await mineCorpusExamples({
      bookKey: 'book-key',
      bookHash: 'book-hash',
      term: 'side',
      topN: 2,
      maxPage: 2,
    });

    expect(examples.length).toBe(2);
    expect(examples.join(' ')).toContain('side');
    expect(mockExtractTextFromDocument).not.toHaveBeenCalled();
  });

  test('falls back to whole-book scan when the book is not indexed', async () => {
    mockIsIndexed.mockResolvedValue(false);

    const docA = document.implementation.createHTMLDocument('a');
    const docB = document.implementation.createHTMLDocument('b');

    const bookDoc: BookDocType = {
      sections: [
        {
          id: 'sec-1',
          size: 100,
          linear: 'yes',
          createDocument: async () => docA,
        },
        {
          id: 'sec-2',
          size: 100,
          linear: 'yes',
          createDocument: async () => docB,
        },
      ],
    };

    mockExtractTextFromDocument
      .mockReturnValueOnce('The companion remained steadfast in silence.')
      .mockReturnValueOnce('Another companion spoke softly.');

    const examples = await mineCorpusExamples({
      bookKey: 'book-key',
      bookHash: 'book-hash',
      bookDoc,
      term: 'companion',
      topN: 2,
    });

    expect(examples).toHaveLength(2);
    expect(examples).toEqual(
      expect.arrayContaining([
        'The companion remained steadfast in silence.',
        'Another companion spoke softly.',
      ]),
    );
    expect(mockExtractTextFromDocument).toHaveBeenCalledTimes(2);
  });

  test('uses local buffers when indexed and whole-book paths are empty', async () => {
    mockIsIndexed.mockResolvedValue(false);

    const examples = await mineCorpusExamples({
      bookKey: 'book-key',
      bookHash: 'book-hash',
      term: 'harbor',
      localPastContext: 'The harbor was calm before dawn.',
      localFutureBuffer: 'No one left the harbor that night.',
      topN: 2,
    });

    expect(examples).toHaveLength(2);
    expect(examples).toEqual(
      expect.arrayContaining([
        'The harbor was calm before dawn.',
        'No one left the harbor that night.',
      ]),
    );
  });

  test('deduplicates repeated sentence matches', async () => {
    mockIsIndexed.mockResolvedValue(true);
    mockGetChunks.mockResolvedValue([
      {
        id: 'chunk-1',
        bookHash: 'book-hash',
        sectionIndex: 0,
        chapterTitle: 'Chapter 1',
        text: 'Repeated match sentence. Repeated match sentence.',
        pageNumber: 1,
      },
    ]);

    const examples = await mineCorpusExamples({
      bookKey: 'book-key',
      bookHash: 'book-hash',
      term: 'match',
      topN: 2,
    });

    expect(examples).toEqual(['Repeated match sentence.']);
  });

  test('matches using base form when provided', async () => {
    mockIsIndexed.mockResolvedValue(true);
    mockGetChunks.mockResolvedValue([
      {
        id: 'chunk-1',
        bookHash: 'book-hash',
        sectionIndex: 0,
        chapterTitle: 'Chapter 1',
        text: '彼は毎晩ここで食べる。',
        pageNumber: 1,
      },
    ]);

    const examples = await mineCorpusExamples({
      bookKey: 'book-key',
      bookHash: 'book-hash',
      term: '食べた',
      baseForm: '食べる',
      topN: 1,
    });

    expect(examples).toEqual(['彼は毎晩ここで食べる。']);
  });
});
