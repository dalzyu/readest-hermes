import { BookDoc, TOCItem, DocumentLoader } from '@/libs/document';
import { Book } from '@/types/book';
import { AppService } from '@/types/system';
import { getAudioAlignmentInputFilename } from '@/utils/book';

import { CanonicalSectionText, extractCanonicalBookText } from './BookCanonicalTextService';
import { BookAudioAsset } from './types';

export interface AudioAlignmentInputAnchor {
  normalizedStart: number;
  normalizedEnd: number;
  cfiStart: string;
  cfiEnd: string;
  text: string;
}

export interface AudioAlignmentInputToken {
  id: string;
  sectionIndex: number;
  sectionHref: string;
  normalizedStart: number;
  normalizedEnd: number;
  originalStart: number;
  originalEnd: number;
  cfiStart: string;
  cfiEnd: string;
  text: string;
  kind: 'word' | 'punctuation' | 'cjkCharacter';
}

export interface AudioAlignmentInputSection {
  sectionIndex: number;
  sectionHref: string;
  normalizedText: string;
  anchors: AudioAlignmentInputAnchor[];
  tokens: AudioAlignmentInputToken[];
}

export interface AudioAlignmentInputTocItem {
  label: string;
  href?: string;
  cfi?: string;
  sectionIndex?: number;
}

export interface AudioAlignmentInputAudioChapter {
  index: number;
  title?: string;
  startMs: number;
  endMs?: number;
}

export interface AudioAlignmentInputAudio {
  title?: string;
  durationMs?: number;
  chapters: AudioAlignmentInputAudioChapter[];
}

export interface AudioAlignmentInput {
  version: 3;
  generator: string;
  language?: string;
  audio: AudioAlignmentInputAudio;
  toc: AudioAlignmentInputTocItem[];
  sections: AudioAlignmentInputSection[];
}

const AUDIO_ALIGNMENT_INPUT_GENERATOR = 'hermes/readest-audio-sync-alignment-input@v3';

function getPrimaryLanguage(language: string | string[] | undefined): string | undefined {
  return Array.isArray(language) ? language[0] : language;
}

function flattenToc(
  items: Array<TOCItem> | undefined,
  output: AudioAlignmentInputTocItem[] = [],
): AudioAlignmentInputTocItem[] {
  for (const item of items || []) {
    output.push({
      label: item.label,
      href: item.href,
      cfi: item.cfi,
    });
    flattenToc(item.subitems, output);
  }
  return output;
}

function normalizeHref(href: string): string {
  return href.split('#')[0] || href;
}

function getUsableSections(sections: CanonicalSectionText[]): CanonicalSectionText[] {
  return sections.filter(
    (section) => section.normalizedText.length > 0 && section.anchors.length > 0,
  );
}

function resolveTocSectionIndex(
  item: AudioAlignmentInputTocItem,
  sections: CanonicalSectionText[],
): number | undefined {
  if (!item.href) {
    return undefined;
  }
  const normalizedHref = normalizeHref(item.href);
  const sectionIndex = sections.findIndex(
    (section) => normalizeHref(section.sectionHref) === normalizedHref,
  );
  return sectionIndex >= 0 ? sectionIndex : undefined;
}

function buildAlignmentInput(
  bookDoc: BookDoc,
  asset: BookAudioAsset,
): Promise<AudioAlignmentInput> {
  return extractCanonicalBookText(bookDoc).then((canonical) => {
    const sections = getUsableSections(canonical.sections);

    return {
      version: 3,
      generator: AUDIO_ALIGNMENT_INPUT_GENERATOR,
      language: getPrimaryLanguage(bookDoc.metadata.language),
      audio: {
        title: asset.title,
        durationMs: asset.durationMs,
        chapters: (asset.chapters || []).map((chapter) => ({
          index: chapter.index,
          title: chapter.title,
          startMs: chapter.startMs,
          endMs: chapter.endMs,
        })),
      },
      toc: flattenToc(bookDoc.toc).map((item) => ({
        ...item,
        sectionIndex: resolveTocSectionIndex(item, sections),
      })),
      sections: sections.map((section, index) => ({
        sectionIndex: index,
        sectionHref: section.sectionHref,
        normalizedText: section.normalizedText,
        anchors: section.anchors.map((anchor) => ({
          normalizedStart: anchor.normalizedStart,
          normalizedEnd: anchor.normalizedEnd,
          cfiStart: anchor.cfiStart,
          cfiEnd: anchor.cfiEnd,
          text: anchor.text,
        })),
        tokens: section.tokens.map((token) => ({
          id: token.id,
          sectionIndex: index,
          sectionHref: section.sectionHref,
          normalizedStart: token.normalizedStart,
          normalizedEnd: token.normalizedEnd,
          originalStart: token.originalStart,
          originalEnd: token.originalEnd,
          cfiStart: token.cfiStart,
          cfiEnd: token.cfiEnd,
          text: token.text,
          kind: token.kind,
        })),
      })),
    };
  });
}

export async function prepareAudioAlignmentInput(
  appService: AppService,
  book: Book,
  asset: BookAudioAsset,
): Promise<string> {
  const { file } = await appService.loadBookContent(book, { preferGeneratedPackage: false });
  const { book: bookDoc } = await new DocumentLoader(file).open();
  const input = await buildAlignmentInput(bookDoc, asset);
  const target = getAudioAlignmentInputFilename(book);
  await appService.writeFile(target, 'Books', JSON.stringify(input, null, 2));
  return await appService.resolveFilePath(target, 'Books');
}
