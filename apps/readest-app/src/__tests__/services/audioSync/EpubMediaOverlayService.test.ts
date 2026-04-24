import { describe, expect, it } from 'vitest';

import { DocumentLoader } from '@/libs/document';
import { extractCanonicalBookText } from '@/services/audioSync/BookCanonicalTextService';
import { createEpubMediaOverlayPackage } from '@/services/audioSync/EpubMediaOverlayService';
import { AudioSyncMap, BookAudioAsset } from '@/services/audioSync/types';
import { Book } from '@/types/book';
import { configureZip } from '@/utils/zip';

async function createFixtureEpub(): Promise<File> {
  await configureZip();
  const { BlobWriter, TextReader, ZipWriter } = await import('@zip.js/zip.js');
  const writer = new ZipWriter(new BlobWriter('application/epub+zip'), {
    extendedTimestamp: false,
  });
  const zipWriteOptions = {
    lastAccessDate: new Date(0),
    lastModDate: new Date(0),
  };

  await writer.add('mimetype', new TextReader('application/epub+zip'), zipWriteOptions);
  await writer.add(
    'META-INF/container.xml',
    new TextReader(`<?xml version="1.0" encoding="UTF-8"?>
      <container xmlns="urn:oasis:names:tc:opendocument:xmlns:container" version="1.0">
        <rootfiles>
          <rootfile full-path="OEBPS/content.opf" media-type="application/oebps-package+xml"/>
        </rootfiles>
      </container>`),
    zipWriteOptions,
  );
  await writer.add(
    'OEBPS/content.opf',
    new TextReader(`<?xml version="1.0" encoding="UTF-8"?>
      <package xmlns="http://www.idpf.org/2007/opf" version="3.0" unique-identifier="book-id">
        <metadata xmlns:dc="http://purl.org/dc/elements/1.1/">
          <dc:identifier id="book-id">urn:uuid:test-book</dc:identifier>
          <dc:title>Fixture</dc:title>
          <dc:language>en</dc:language>
        </metadata>
        <manifest>
          <item id="chapter-1" href="text/chapter1.xhtml" media-type="application/xhtml+xml"/>
        </manifest>
        <spine>
          <itemref idref="chapter-1"/>
        </spine>
      </package>`),
    zipWriteOptions,
  );
  await writer.add(
    'OEBPS/text/chapter1.xhtml',
    new TextReader(`<?xml version="1.0" encoding="UTF-8"?>
      <html xmlns="http://www.w3.org/1999/xhtml">
        <head><title>Chapter 1</title></head>
        <body><p>Hello brave new world.</p></body>
      </html>`),
    zipWriteOptions,
  );

  const blob = await writer.close();
  return new File([blob], 'fixture.epub', { type: 'application/epub+zip' });
}

function makeBook(): Book {
  return {
    hash: 'book-hash',
    format: 'EPUB',
    title: 'Fixture',
    author: 'Tester',
    createdAt: 1,
    updatedAt: 1,
  };
}

async function buildMap(
  sourceFile: File,
  book: Book,
  asset: BookAudioAsset,
): Promise<AudioSyncMap> {
  const { book: bookDoc } = await new DocumentLoader(sourceFile).open();
  const canonical = await extractCanonicalBookText(bookDoc);
  const section = canonical.sections[0]!;
  const hello = section.tokens.find((token) => token.text === 'Hello')!;
  const brave = section.tokens.find((token) => token.text === 'brave')!;

  return {
    id: 'map-1',
    version: 2,
    bookHash: book.hash,
    audioHash: asset.audioHash,
    granularity: 'word',
    status: 'ready',
    coverage: { matchedChars: 11, totalChars: 11, matchedRatio: 1 },
    confidence: { overall: 0.99, byChapter: { chapter1: 0.99 } },
    segments: [
      {
        id: 'segment-1',
        sectionHref: section.sectionHref,
        cfiStart: hello.cfiStart,
        cfiEnd: brave.cfiEnd,
        text: 'Hello brave',
        audioStartMs: 0,
        audioEndMs: 900,
        confidence: 0.99,
        words: [
          {
            id: 'word-1',
            sectionHref: section.sectionHref,
            cfiStart: hello.cfiStart,
            cfiEnd: hello.cfiEnd,
            text: hello.text,
            audioStartMs: 0,
            audioEndMs: 400,
            confidence: 0.99,
          },
          {
            id: 'word-2',
            sectionHref: section.sectionHref,
            cfiStart: brave.cfiStart,
            cfiEnd: brave.cfiEnd,
            text: brave.text,
            audioStartMs: 400,
            audioEndMs: 900,
            confidence: 0.99,
          },
        ],
      },
    ],
    createdAt: 1,
    updatedAt: 1,
  };
}

describe('createEpubMediaOverlayPackage', () => {
  it('generates a loadable EPUB3 media overlay package with SMIL and fragment targets', async () => {
    const sourceFile = await createFixtureEpub();
    const book = makeBook();
    const audioFile = new File(['audio'], 'asset.mp3', { type: 'audio/mpeg' });
    const asset: BookAudioAsset = {
      id: 'asset-1',
      bookHash: book.hash,
      audioHash: 'audio-hash',
      originalPath: `${book.hash}/audio/source.mp3`,
      originalFilename: 'source.mp3',
      normalizedPath: `${book.hash}/audio/normalized.mp3`,
      format: 'mp3',
      normalizedFormat: 'mp3',
      durationMs: 2_000,
      createdAt: 1,
      updatedAt: 1,
    };
    const map = await buildMap(sourceFile, book, asset);

    const result = await createEpubMediaOverlayPackage({
      book,
      sourceFile,
      audioFile,
      asset,
      map,
    });

    expect(result.provenance.validation.valid).toBe(true);
    expect(result.provenance.packagePath).toContain('synced.epub');

    const { book: generatedBook } = await new DocumentLoader(result.file).open();
    const generatedSection = generatedBook.sections[0] as {
      mediaOverlay?: unknown;
      createDocument: () => Promise<Document>;
    };
    expect(generatedSection.mediaOverlay).not.toBeNull();

    const generatedDoc = await generatedSection.createDocument();
    const serialized = generatedDoc.documentElement.outerHTML;
    expect(serialized).toContain('cfi-inert');
    expect(serialized).toContain('data-audio-sync="word"');
  });
});
