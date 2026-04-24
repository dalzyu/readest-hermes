import * as CFI from 'foliate-js/epubcfi.js';

import { SectionItem } from '@/libs/document';

export function getSectionBaseCfi(section: SectionItem, index: number): string {
  return section.cfi || CFI.fake.fromIndex(index);
}

export function getRangeCfi(section: SectionItem, index: number, range: Range): string {
  return CFI.joinIndir(getSectionBaseCfi(section, index), CFI.fromRange(range));
}

export function getPointCfi(
  section: SectionItem,
  index: number,
  doc: Document,
  node: Node,
  offset: number,
): string {
  const range = doc.createRange();
  range.setStart(node, offset);
  range.setEnd(node, offset);
  return getRangeCfi(section, index, range);
}
