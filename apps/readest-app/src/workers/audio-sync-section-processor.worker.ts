import { DOMParser, XMLSerializer } from '@xmldom/xmldom';
import * as CFI from 'foliate-js/epubcfi.js';
import type {
  SectionProcessorRequest,
  SectionProcessorResponse,
} from '../services/audioSync/audio-sync-worker-protocol';

const workerContext: DedicatedWorkerGlobalScope = self as unknown as DedicatedWorkerGlobalScope;

class RangeImpl {
  startContainer: Node | null = null;
  startOffset = 0;
  endContainer: Node | null = null;
  endOffset = 0;

  setStart(node: Node, offset: number) {
    this.startContainer = node;
    this.startOffset = offset ?? 0;
  }

  setEnd(node: Node, offset: number) {
    this.endContainer = node;
    this.endOffset = offset ?? 0;
  }

  setStartBefore(node: Node) {
    const parent = node.parentNode || node;
    this.setStart(parent, indexOfNode(node));
  }

  setStartAfter(node: Node) {
    const parent = node.parentNode || node;
    this.setStart(parent, indexOfNode(node) + 1);
  }

  setEndBefore(node: Node) {
    const parent = node.parentNode || node;
    this.setEnd(parent, indexOfNode(node));
  }

  setEndAfter(node: Node) {
    const parent = node.parentNode || node;
    this.setEnd(parent, indexOfNode(node) + 1);
  }
}

function indexOfNode(node: Node): number {
  const parent = node.parentNode;
  if (!parent) return 0;
  const siblings = Array.from(parent.childNodes) as Node[];
  const index = siblings.indexOf(node);
  return index >= 0 ? index : 0;
}

function ensureCreateRange(doc: unknown): void {
  const docWithRange = doc as { createRange?: () => unknown };
  if (typeof docWithRange.createRange === 'function') return;
  docWithRange.createRange = () => new RangeImpl();
}

function parseXml(text: string, mimeType: string): Document {
  const doc = new DOMParser().parseFromString(text, mimeType as DOMParserSupportedType);
  if (doc.getElementsByTagName('parsererror').length > 0) {
    throw new Error(`Failed to parse ${mimeType} document`);
  }
  ensureCreateRange(doc);
  return doc as unknown as Document;
}

function serializeXml(doc: Document): string {
  return new XMLSerializer().serializeToString(doc as unknown as import('@xmldom/xmldom').Node);
}

function toLocalCfi(cfi: string): string {
  if (!cfi.startsWith('epubcfi(') || !cfi.endsWith(')')) {
    return cfi;
  }
  const inner = cfi.slice(8, -1);
  const bangIndex = inner.lastIndexOf('!');
  return bangIndex >= 0 ? `epubcfi(${inner.slice(bangIndex + 1)})` : cfi;
}

function resolvePointRange(doc: Document, cfi: string): Range {
  const range = CFI.toRange(doc, CFI.parse(toLocalCfi(cfi)));
  if (!range) {
    throw new Error(`Unable to resolve CFI ${cfi}`);
  }
  return range;
}

function resolveTargetRange(doc: Document, startCfi: string, endCfi: string): Range {
  const start = resolvePointRange(doc, startCfi);
  const end = resolvePointRange(doc, endCfi);
  const range = doc.createRange();
  range.setStart(start.startContainer, start.startOffset);
  range.setEnd(end.startContainer, end.startOffset);
  return range;
}

function nearestTargetElement(node: Node): Element | null {
  let current: Node | null = node.nodeType === 1 ? node : node.parentNode;
  while (current && current.nodeType === 1) {
    const element = current as Element;
    const tag = String((element as unknown as { tagName?: string }).tagName || '').toLowerCase();
    if (tag !== 'body' && tag !== 'html' && (element.textContent || '').trim()) {
      return element;
    }
    current = current.parentNode;
  }
  return null;
}

function wrapTextRange(doc: Document, range: Range, id: string): string | null {
  const textNode = range.startContainer;
  if (
    textNode.nodeType !== 3 ||
    textNode !== range.endContainer ||
    range.startOffset === range.endOffset
  ) {
    return null;
  }

  const text = textNode as Text;
  const value = text.nodeValue || '';
  if (
    range.startOffset < 0 ||
    range.endOffset > value.length ||
    range.startOffset >= range.endOffset
  ) {
    return null;
  }

  const beforeText = value.slice(0, range.startOffset);
  const middleText = value.slice(range.startOffset, range.endOffset);
  const afterText = value.slice(range.endOffset);
  const fragment = doc.createDocumentFragment();

  if (beforeText) {
    fragment.appendChild(doc.createTextNode(beforeText));
  }

  const span = doc.createElementNS('http://www.w3.org/1999/xhtml', 'span');
  span.setAttribute('id', id);
  span.setAttribute('cfi-inert', '');
  span.setAttribute('data-audio-sync', 'word');
  span.textContent = middleText;
  fragment.appendChild(span);

  if (afterText) {
    fragment.appendChild(doc.createTextNode(afterText));
  }

  text.parentNode?.replaceChild(fragment, text);
  return id;
}

function ensureFragmentTarget(
  doc: Document,
  entry: { id: string; cfiStart: string; cfiEnd: string; kind: 'word' | 'segment' },
  id: string,
): string | null {
  let range: Range;
  try {
    range = resolveTargetRange(doc, entry.cfiStart, entry.cfiEnd);
  } catch {
    return null;
  }

  if (entry.kind === 'word') {
    const fragmentId = wrapTextRange(doc, range, id);
    if (fragmentId) {
      return fragmentId;
    }
    const fallback = nearestTargetElement(range.startContainer);
    if (!fallback) return null;
    if (!fallback.getAttribute('id')) {
      fallback.setAttribute('id', id);
    }
    fallback.setAttribute('data-audio-sync', 'segment');
    return fallback.getAttribute('id') || id;
  }

  const element = nearestTargetElement(range.startContainer);
  if (!element) return null;
  if (!element.getAttribute('id')) {
    element.setAttribute('id', id);
  }
  element.setAttribute('data-audio-sync', 'segment');
  return element.getAttribute('id') || id;
}

function sanitizeFragmentSegment(value: string): string {
  return (
    value
      .replace(/[^a-z0-9]+/gi, '-')
      .replace(/^-+|-+$/g, '')
      .toLowerCase() || 'section'
  );
}

workerContext.onmessage = async (event: MessageEvent<SectionProcessorRequest>) => {
  if (event.data.type !== 'process-section') return;

  const { sectionPath, content, mimeType, entries } = event.data.payload;

  try {
    const doc = parseXml(content, mimeType);
    const fragmentIds = new Array(entries.length).fill('');

    for (let index = entries.length - 1; index >= 0; index--) {
      const entry = entries[index];
      if (!entry) continue;
      const fragmentId = ensureFragmentTarget(
        doc,
        entry,
        `as-${sanitizeFragmentSegment(sectionPath)}-${entry.kind}-${index}`,
      );
      fragmentIds[index] = fragmentId || '';
    }

    const processedContent = serializeXml(doc);
    const response: SectionProcessorResponse = {
      type: 'success',
      payload: {
        sectionPath,
        content: processedContent,
        fragmentIds,
      },
    };
    workerContext.postMessage(response);
  } catch (error) {
    const response: SectionProcessorResponse = {
      type: 'error',
      payload: {
        sectionPath,
        message: error instanceof Error ? error.message : String(error),
      },
    };
    workerContext.postMessage(response);
  }
};
