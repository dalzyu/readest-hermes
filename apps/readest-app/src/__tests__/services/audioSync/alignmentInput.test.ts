import { beforeEach, describe, expect, it, vi } from 'vitest';

import { prepareAudioAlignmentInput } from '@/services/audioSync/alignmentInput';
import { AppService } from '@/types/system';
import { Book } from '@/types/book';
import { BookAudioAsset } from '@/services/audioSync/types';

const mockOpen = vi.fn();
const mockExtractCanonicalBookText = vi.fn();

vi.mock('@/libs/document', () => ({
  DocumentLoader: class {
    open() {
      return mockOpen();
    }
  },
}));

vi.mock('@/services/audioSync/BookCanonicalTextService', () => ({
  extractCanonicalBookText: (...args: unknown[]) => mockExtractCanonicalBookText(...args),
}));

function makeBook(overrides: Partial<Book> = {}): Book {
  return {
    hash: 'book-1',
    format: 'EPUB',
    title: 'Example Book',
    author: 'Author',
    createdAt: 1,
    updatedAt: 2,
    ...overrides,
  };
}

function makeAsset(): BookAudioAsset {
  return {
    id: 'asset-1',
    bookHash: 'book-1',
    audioHash: 'audio-1',
    originalPath: 'book-1/audio/source.m4b',
    originalFilename: 'source.m4b',
    format: 'm4b',
    durationMs: 120000,
    chapters: [
      { index: 0, title: 'Chapter 1', startMs: 0, endMs: 60000 },
      { index: 1, title: 'Chapter 2', startMs: 60000, endMs: 120000 },
    ],
    createdAt: 1,
    updatedAt: 2,
  };
}

describe('prepareAudioAlignmentInput', () => {
  beforeEach(() => {
    mockOpen.mockReset();
    mockExtractCanonicalBookText.mockReset();
  });

  it('writes canonical alignment input with TOC section mapping and audio chapters', async () => {
    const book = makeBook();
    const asset = makeAsset();
    const writeFile = vi.fn().mockResolvedValue(undefined);
    const appService = {
      loadBookContent: vi.fn().mockResolvedValue({
        book,
        file: new File(['epub'], 'book.epub', { type: 'application/epub+zip' }),
      }),
      writeFile,
      resolveFilePath: vi.fn().mockResolvedValue('C:/Books/book-1/audio/alignment-input.v3.json'),
    } as Pick<AppService, 'loadBookContent' | 'writeFile' | 'resolveFilePath'> as AppService;

    mockOpen.mockResolvedValue({
      book: {
        metadata: { title: 'Example Book', author: 'Author', language: ['en'] },
        rendition: { layout: 'reflowable' },
        dir: 'ltr',
        toc: [
          { id: 1, label: 'Chapter 1', href: 'chapter1.xhtml' },
          { id: 2, label: 'Chapter 2', href: 'chapter2.xhtml#frag' },
        ],
        sections: [],
        splitTOCHref: vi.fn(),
        getCover: vi.fn(),
      },
      format: 'EPUB',
    });

    mockExtractCanonicalBookText.mockResolvedValue({
      normalizedText: 'One Two',
      totalLength: 7,
      sections: [
        {
          sectionIndex: 0,
          sectionHref: 'chapter1.xhtml',
          sectionCfi: 'epubcfi(/6/2)',
          normalizedText: 'One',
          anchors: [
            {
              normalizedStart: 0,
              normalizedEnd: 3,
              cfiStart: 'cfi-1a',
              cfiEnd: 'cfi-1b',
              text: 'One',
            },
          ],
          tokens: [
            {
              id: 's0-t0',
              sectionIndex: 0,
              sectionHref: 'chapter1.xhtml',
              normalizedStart: 0,
              normalizedEnd: 3,
              originalStart: 0,
              originalEnd: 3,
              cfiStart: 'cfi-1a',
              cfiEnd: 'cfi-1b',
              text: 'One',
              kind: 'word',
            },
          ],
        },
        {
          sectionIndex: 1,
          sectionHref: 'chapter2.xhtml',
          sectionCfi: 'epubcfi(/6/4)',
          normalizedText: 'Two',
          anchors: [
            {
              normalizedStart: 0,
              normalizedEnd: 3,
              cfiStart: 'cfi-2a',
              cfiEnd: 'cfi-2b',
              text: 'Two',
            },
          ],
          tokens: [
            {
              id: 's1-t0',
              sectionIndex: 1,
              sectionHref: 'chapter2.xhtml',
              normalizedStart: 0,
              normalizedEnd: 3,
              originalStart: 0,
              originalEnd: 3,
              cfiStart: 'cfi-2a',
              cfiEnd: 'cfi-2b',
              text: 'Two',
              kind: 'word',
            },
          ],
        },
      ],
    });

    const resolvedPath = await prepareAudioAlignmentInput(appService, book, asset);

    expect(resolvedPath).toBe('C:/Books/book-1/audio/alignment-input.v3.json');
    expect(writeFile).toHaveBeenCalledTimes(1);
    expect(writeFile).toHaveBeenCalledWith(
      'book-1/audio/alignment-input.v3.json',
      'Books',
      expect.any(String),
    );

    const payload = JSON.parse(writeFile.mock.calls[0]![2] as string);
    expect(payload.version).toBe(3);
    expect(payload.generator).toBe('hermes/readest-audio-sync-alignment-input@v3');
    expect(payload.language).toBe('en');
    expect(payload.audio).toEqual({
      title: undefined,
      durationMs: 120000,
      chapters: [
        { index: 0, title: 'Chapter 1', startMs: 0, endMs: 60000 },
        { index: 1, title: 'Chapter 2', startMs: 60000, endMs: 120000 },
      ],
    });
    expect(payload.toc).toEqual([
      { label: 'Chapter 1', href: 'chapter1.xhtml', sectionIndex: 0 },
      { label: 'Chapter 2', href: 'chapter2.xhtml#frag', sectionIndex: 1 },
    ]);
    expect(payload.sections).toEqual([
      {
        sectionIndex: 0,
        sectionHref: 'chapter1.xhtml',
        normalizedText: 'One',
        anchors: [
          {
            normalizedStart: 0,
            normalizedEnd: 3,
            cfiStart: 'cfi-1a',
            cfiEnd: 'cfi-1b',
            text: 'One',
          },
        ],
        tokens: [
          {
            id: 's0-t0',
            sectionIndex: 0,
            sectionHref: 'chapter1.xhtml',
            normalizedStart: 0,
            normalizedEnd: 3,
            originalStart: 0,
            originalEnd: 3,
            cfiStart: 'cfi-1a',
            cfiEnd: 'cfi-1b',
            text: 'One',
            kind: 'word',
          },
        ],
      },
      {
        sectionIndex: 1,
        sectionHref: 'chapter2.xhtml',
        normalizedText: 'Two',
        anchors: [
          {
            normalizedStart: 0,
            normalizedEnd: 3,
            cfiStart: 'cfi-2a',
            cfiEnd: 'cfi-2b',
            text: 'Two',
          },
        ],
        tokens: [
          {
            id: 's1-t0',
            sectionIndex: 1,
            sectionHref: 'chapter2.xhtml',
            normalizedStart: 0,
            normalizedEnd: 3,
            originalStart: 0,
            originalEnd: 3,
            cfiStart: 'cfi-2a',
            cfiEnd: 'cfi-2b',
            text: 'Two',
            kind: 'word',
          },
        ],
      },
    ]);
  });
});
