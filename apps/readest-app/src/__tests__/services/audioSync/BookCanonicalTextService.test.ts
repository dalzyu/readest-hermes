import { describe, expect, it } from 'vitest';

import { BookDoc, SectionItem } from '@/libs/document';
import { extractCanonicalBookText } from '@/services/audioSync/BookCanonicalTextService';

function makeSection(index: number, html: string): SectionItem {
  return {
    id: `section-${index}`,
    href: `chapter-${index + 1}.xhtml`,
    cfi: `epubcfi(/6/${(index + 1) * 2})`,
    size: 1,
    linear: 'yes',
    createDocument: async () => new DOMParser().parseFromString(html, 'application/xhtml+xml'),
  };
}

function makeBookDoc(
  sections: SectionItem[],
  layout: BookDoc['rendition']['layout'] = 'reflowable',
): BookDoc {
  return {
    metadata: { title: 'Test', author: 'Author', language: 'en' },
    rendition: { layout },
    dir: 'ltr',
    sections,
    splitTOCHref: (href: string) => [href, 0],
    getCover: async () => null,
  };
}

describe('extractCanonicalBookText', () => {
  it('extracts normalized text and cfi anchors from reflowable sections', async () => {
    const bookDoc = makeBookDoc([
      makeSection(
        0,
        '<html xmlns="http://www.w3.org/1999/xhtml"><body><p>Hello   world</p><a role="doc-noteref">1</a><p>Next line</p></body></html>',
      ),
      makeSection(
        1,
        '<html xmlns="http://www.w3.org/1999/xhtml"><body><p>Another — chapter</p></body></html>',
      ),
    ]);

    const result = await extractCanonicalBookText(bookDoc);

    expect(result.normalizedText).toBe('Hello world Next line\n\nAnother - chapter');
    expect(result.sections).toHaveLength(2);
    expect(result.sections[0]!.normalizedText).toBe('Hello world Next line');
    expect(result.sections[0]!.anchors).toHaveLength(2);
    expect(result.sections[0]!.tokens.map((token) => token.text)).toEqual([
      'Hello',
      'world',
      'Next',
      'line',
    ]);
    expect(result.sections[0]!.tokens[0]).toMatchObject({ originalStart: 0, originalEnd: 5 });
    expect(result.sections[0]!.tokens[1]).toMatchObject({ originalStart: 8, originalEnd: 13 });
    expect(result.sections[0]!.anchors[0]!.cfiStart.startsWith('epubcfi(/6/2')).toBe(true);
    expect(result.sections[0]!.anchors[0]!.normalizedStart).toBe(0);
    expect(result.sections[0]!.anchors[1]!.normalizedStart).toBe(12);
    expect(result.sections[1]!.normalizedText).toBe('Another - chapter');
  });

  it('serializes punctuation normalization into exact token spans', async () => {
    const bookDoc = makeBookDoc([
      makeSection(
        0,
        '<html xmlns="http://www.w3.org/1999/xhtml"><body><p>“Hello” — world…</p></body></html>',
      ),
    ]);

    const result = await extractCanonicalBookText(bookDoc);

    expect(result.sections[0]!.normalizedText).toBe('"Hello" - world...');
    expect(result.sections[0]!.tokens.map((token) => [token.text, token.kind])).toEqual([
      ['"', 'punctuation'],
      ['Hello', 'word'],
      ['"', 'punctuation'],
      ['-', 'punctuation'],
      ['world', 'word'],
      ['...', 'punctuation'],
    ]);
    expect(result.sections[0]!.tokens[5]).toMatchObject({ originalStart: 15, originalEnd: 16 });
  });

  it('creates seekable token units for cjk text without spaces', async () => {
    const bookDoc = makeBookDoc([
      makeSection(
        0,
        '<html xmlns="http://www.w3.org/1999/xhtml"><body><p>你好世界</p></body></html>',
      ),
    ]);

    const result = await extractCanonicalBookText(bookDoc);

    expect(result.sections[0]!.tokens.map((token) => [token.text, token.kind])).toEqual([
      ['你', 'cjkCharacter'],
      ['好', 'cjkCharacter'],
      ['世', 'cjkCharacter'],
      ['界', 'cjkCharacter'],
    ]);
    expect(result.sections[0]!.tokens[2]).toMatchObject({ originalStart: 2, originalEnd: 3 });
  });

  it('skips decorative footnote backlinks and empty text nodes', async () => {
    const bookDoc = makeBookDoc([
      makeSection(
        0,
        '<html xmlns="http://www.w3.org/1999/xhtml" xmlns:epub="http://www.idpf.org/2007/ops"><body><p>Alpha</p><a epub:type="noteref">*</a><p>Beta</p></body></html>',
      ),
    ]);

    const result = await extractCanonicalBookText(bookDoc);

    expect(result.sections[0]!.normalizedText).toBe('Alpha Beta');
    expect(result.sections[0]!.anchors).toHaveLength(2);
    expect(result.sections[0]!.anchors.map((anchor) => anchor.text)).toEqual(['Alpha', 'Beta']);
    expect(result.sections[0]!.tokens.map((token) => token.text)).toEqual(['Alpha', 'Beta']);
  });

  it('rejects pre-paginated books', async () => {
    const bookDoc = makeBookDoc(
      [
        makeSection(
          0,
          '<html xmlns="http://www.w3.org/1999/xhtml"><body><p>Fixed</p></body></html>',
        ),
      ],
      'pre-paginated',
    );

    await expect(extractCanonicalBookText(bookDoc)).rejects.toThrow(
      'Canonical text extraction only supports reflowable books',
    );
  });
});
