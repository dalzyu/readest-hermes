import { beforeEach, describe, expect, test, vi } from 'vitest';
import type { TextChunk } from '@/services/ai/types';

vi.mock('@/services/ai/storage/aiStore', () => ({
  aiStore: {
    getChunks: vi.fn(),
  },
}));

import { aiStore } from '@/services/ai/storage/aiStore';
import { getPopupLocalContext } from '@/services/contextTranslation/pageContextService';

const mockAiStore = vi.mocked(aiStore);

function makeChunk(pageNumber: number, text: string): TextChunk {
  return {
    id: `book-0-${pageNumber}`,
    bookHash: 'book-abc',
    sectionIndex: 0,
    chapterTitle: 'Chapter 1',
    text,
    pageNumber,
  };
}

beforeEach(() => {
  vi.clearAllMocks();
});

describe('getPopupLocalContext', () => {
  const chunks: TextChunk[] = [
    makeChunk(1, 'Text from page one.'),
    makeChunk(2, 'Text from page two.'),
    makeChunk(3, 'Text from page three with 知己 and a few trailing words.'),
    makeChunk(4, 'Text from page four.'),
    makeChunk(5, 'Text from page five.'),
  ];

  test('returns text from the last N pages up to the selected text', async () => {
    mockAiStore.getChunks.mockResolvedValueOnce(chunks);

    const result = await getPopupLocalContext('book-abc', 3, 3, '知己', 0);

    expect(result.localPastContext).toContain('page one');
    expect(result.localPastContext).toContain('page two');
    expect(result.localPastContext).toContain('知己');
    expect(result.localPastContext).not.toContain('page four');
  });

  test('does not include chunks beyond currentPage in the local past context', async () => {
    mockAiStore.getChunks.mockResolvedValueOnce(chunks);

    const result = await getPopupLocalContext('book-abc', 3, 2, '知己', 0);

    expect(result.localPastContext).not.toContain('page four');
    expect(result.localPastContext).not.toContain('page five');
  });

  test('returns empty sections when no chunks exist', async () => {
    mockAiStore.getChunks.mockResolvedValueOnce([]);

    const result = await getPopupLocalContext('book-abc', 3, 5, '知己', 5);

    expect(result.localPastContext).toBe('');
    expect(result.localFutureBuffer).toBe('');
  });

  test('handles currentPage beyond available chunks', async () => {
    mockAiStore.getChunks.mockResolvedValueOnce(chunks);

    const result = await getPopupLocalContext('book-abc', 99, 2, 'missing', 0);

    expect(result.localPastContext).toContain('page four');
    expect(result.localPastContext).toContain('page five');
  });

  test('joins multiple chunks on the same page into one text block', async () => {
    const multiChunks: TextChunk[] = [
      makeChunk(1, 'First chunk on page 1.'),
      makeChunk(1, 'Second chunk on page 1.'),
      makeChunk(2, 'Page 2 text.'),
    ];
    mockAiStore.getChunks.mockResolvedValueOnce(multiChunks);

    const result = await getPopupLocalContext('book-abc', 2, 2, 'missing', 0);

    expect(result.localPastContext).toContain('First chunk on page 1.');
    expect(result.localPastContext).toContain('Second chunk on page 1.');
    expect(result.localPastContext).toContain('Page 2 text.');
  });

  test('builds a bounded future buffer from later words and pages', async () => {
    mockAiStore.getChunks.mockResolvedValueOnce(chunks);

    const result = await getPopupLocalContext('book-abc', 3, 2, '知己', 8);

    expect(result.localFutureBuffer.length).toBeGreaterThan(0);
  });
});
