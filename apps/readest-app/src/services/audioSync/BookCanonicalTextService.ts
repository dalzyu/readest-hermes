import { BookDoc, SectionItem } from '@/libs/document';

import { getPointCfi, getSectionBaseCfi } from './cfiMapping';
import {
  CanonicalTextTokenKind,
  shouldIgnoreCanonicalTextNode,
  tokenizeCanonicalText,
} from './textNormalization';

export interface CanonicalTextAnchor {
  normalizedStart: number;
  normalizedEnd: number;
  cfiStart: string;
  cfiEnd: string;
  text: string;
}

export interface CanonicalTextToken {
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
  kind: CanonicalTextTokenKind;
}

export interface CanonicalSectionText {
  sectionIndex: number;
  sectionHref: string;
  sectionCfi: string;
  normalizedText: string;
  anchors: CanonicalTextAnchor[];
  tokens: CanonicalTextToken[];
}

export interface CanonicalBookText {
  normalizedText: string;
  totalLength: number;
  sections: CanonicalSectionText[];
}

function appendChunk(target: string, chunk: string): { text: string; start: number; end: number } {
  const needsSeparator = target.length > 0;
  const next = needsSeparator ? `${target} ${chunk}` : chunk;
  const start = needsSeparator ? target.length + 1 : 0;
  return { text: next, start, end: next.length };
}

function extractSectionText(
  section: SectionItem,
  index: number,
  doc: Document,
): CanonicalSectionText {
  const root = doc.body ?? doc.documentElement;
  const walker = doc.createTreeWalker(root, NodeFilter.SHOW_TEXT, {
    acceptNode: (node) => {
      if (!(node instanceof Text) || shouldIgnoreCanonicalTextNode(node)) {
        return NodeFilter.FILTER_REJECT;
      }
      return NodeFilter.FILTER_ACCEPT;
    },
  });

  let normalizedText = '';
  const anchors: CanonicalTextAnchor[] = [];
  const tokens: CanonicalTextToken[] = [];
  let tokenIndex = 0;

  for (let node = walker.nextNode(); node; node = walker.nextNode()) {
    if (!(node instanceof Text)) {
      continue;
    }
    const normalized = tokenizeCanonicalText(node.textContent || '');
    const chunk = normalized.text;
    if (!chunk) {
      continue;
    }

    const { text, start, end } = appendChunk(normalizedText, chunk);
    normalizedText = text;

    const nodeLength = node.textContent?.length ?? 0;
    anchors.push({
      normalizedStart: start,
      normalizedEnd: end,
      cfiStart: getPointCfi(section, index, doc, node, 0),
      cfiEnd: getPointCfi(section, index, doc, node, nodeLength),
      text: chunk,
    });

    for (const token of normalized.tokens) {
      tokens.push({
        id: `s${index}-t${tokenIndex}`,
        sectionIndex: index,
        sectionHref: section.href || section.id,
        normalizedStart: start + token.normalizedStart,
        normalizedEnd: start + token.normalizedEnd,
        originalStart: token.originalStart,
        originalEnd: token.originalEnd,
        cfiStart: getPointCfi(section, index, doc, node, token.originalStart),
        cfiEnd: getPointCfi(section, index, doc, node, token.originalEnd),
        text: token.text,
        kind: token.kind,
      });
      tokenIndex += 1;
    }
  }

  return {
    sectionIndex: index,
    sectionHref: section.href || section.id,
    sectionCfi: getSectionBaseCfi(section, index),
    normalizedText,
    anchors,
    tokens,
  };
}

export async function extractCanonicalBookText(bookDoc: BookDoc): Promise<CanonicalBookText> {
  if (bookDoc.rendition.layout === 'pre-paginated') {
    throw new Error('Canonical text extraction only supports reflowable books');
  }

  const sections: CanonicalSectionText[] = [];
  for (const [index, section] of bookDoc.sections.entries()) {
    const doc = await section.createDocument();
    sections.push(extractSectionText(section, index, doc));
  }

  const normalizedText = sections
    .map((section) => section.normalizedText)
    .filter((sectionText) => sectionText.length > 0)
    .join('\n\n');

  return {
    normalizedText,
    totalLength: normalizedText.length,
    sections,
  };
}
