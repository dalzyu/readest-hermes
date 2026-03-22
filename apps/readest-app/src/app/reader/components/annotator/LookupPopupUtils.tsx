import React from 'react';
import { pinyin as pinyinPro } from 'pinyin-pro';
import type {
  LookupAnnotations,
  PopupContextBundle,
  PopupRetrievalHints,
  RetrievalStatus,
  TranslationResult,
} from '@/services/contextTranslation/types';
import {
  type ExampleMatchRange,
  findExampleMatchRanges,
} from '@/services/contextTranslation/exampleMatcher';
import {
  HAN_REGEX,
  HIRAGANA_REGEX,
  KATAKANA_REGEX,
  type CJKLanguage,
  getCJKLanguage,
  isJapaneseText,
  isChineseText,
} from '@/services/contextTranslation/utils';

export { type ExampleMatchRange, findExampleMatchRanges };
export type { CJKLanguage };
export { getCJKLanguage, isJapaneseText, isChineseText, HAN_REGEX, HIRAGANA_REGEX, KATAKANA_REGEX };

export function getPinyinLabel(value: string): string {
  return pinyinPro(value, {
    toneType: 'symbol',
    type: 'string',
    nonZh: 'removed',
  }).trim();
}

export function getPinyinParts(value: string): string[] {
  return pinyinPro(value, { toneType: 'symbol', type: 'array' });
}

export function getHighlightedIndices(value: string, highlightText: string): Set<number> {
  const indices = new Set<number>();
  if (!highlightText) return indices;

  let startIndex = value.indexOf(highlightText);
  while (startIndex !== -1) {
    for (let i = startIndex; i < startIndex + highlightText.length; i += 1) {
      indices.add(i);
    }
    startIndex = value.indexOf(highlightText, startIndex + highlightText.length);
  }

  return indices;
}

export function getHighlightKindAtIndex(
  ranges: { start: number; end: number; kind: 'exact' | 'variant' }[],
  index: number,
): 'exact' | 'variant' | null {
  let foundKind: 'exact' | 'variant' | null = null;

  for (const range of ranges) {
    if (index < range.start || index >= range.end) continue;
    if (range.kind === 'exact') return 'exact';
    foundKind = 'variant';
  }

  return foundKind;
}

export function getRetrievalStatusMeta(status: RetrievalStatus): {
  label: string;
  className: string;
} {
  switch (status) {
    case 'cross-volume':
      return {
        label: 'Cross-volume context',
        className: 'border-green-400/40 bg-green-400/10 text-green-200',
      };
    case 'local-volume':
      return {
        label: 'Local volume context only',
        className: 'border-yellow-400/40 bg-yellow-400/10 text-yellow-200',
      };
    default:
      return {
        label: 'Local context only',
        className: 'border-red-400/40 bg-red-400/10 text-red-200',
      };
  }
}

export function buildRetrievalInfoText(
  status: RetrievalStatus,
  hints: PopupRetrievalHints,
): string {
  if (status === 'local-only') {
    if (hints.missingLocalIndex) {
      return hints.missingPriorVolumes.length > 0
        ? `Index this volume first. Then index volumes ${hints.missingPriorVolumes.join(', ')} to enable cross-volume context.`
        : 'Index this volume to enable local-volume and cross-volume retrieval.';
    }
    if (hints.missingSeriesAssignment) {
      return 'Add this book to a series and index earlier volumes to enable cross-volume context.';
    }
  }

  if (status === 'local-volume') {
    if (hints.missingSeriesAssignment) {
      return 'Add this book to a series to enable cross-volume context.';
    }
    if (hints.missingPriorVolumes.length > 0) {
      return `Index volumes ${hints.missingPriorVolumes.join(', ')} to enable cross-volume context.`;
    }
  }

  if (hints.missingPriorVolumes.length > 0) {
    return `Earlier volume retrieval is active. Index volumes ${hints.missingPriorVolumes.join(', ')} for fuller cross-volume context.`;
  }

  return 'This lookup is using recent local context, earlier same-book memory, and prior-volume memory.';
}

export function buildAskAboutThisMessage(
  selectedText: string,
  result: TranslationResult,
  popupContext: PopupContextBundle,
): string {
  const resultSections = Object.entries(result)
    .filter(([, value]) => value.trim().length > 0)
    .map(([field, value]) => `${field}:\n${value}`);

  const sections = [
    `Selection:\n${selectedText}`,
    ...resultSections,
    `Local Past Context:\n${popupContext.localPastContext || '[none]'}`,
    popupContext.localFutureBuffer ? `Local Future Buffer:\n${popupContext.localFutureBuffer}` : '',
    popupContext.sameBookChunks.length > 0
      ? `Same-Book Memory:\n${popupContext.sameBookChunks.join('\n\n')}`
      : '',
    popupContext.priorVolumeChunks.length > 0
      ? `Prior-Volume Memory:\n${popupContext.priorVolumeChunks.join('\n\n')}`
      : '',
    'Question:\nHelp me understand this selection in more detail.',
  ].filter(Boolean);

  return sections.join('\n\n');
}

export function renderExamplePhonetic(
  annotation: LookupAnnotations | undefined,
  exampleId: string,
) {
  const phonetic = annotation?.examples?.[exampleId]?.phonetic;
  if (!phonetic) return null;

  return <p className='mb-1 text-[0.7rem] font-medium text-cyan-200'>{phonetic}</p>;
}

export function RubyText({
  text,
  highlightText,
  className,
}: {
  text: string;
  highlightText?: string;
  className?: string;
}) {
  const highlightedIndices = getHighlightedIndices(text, highlightText ?? '');
  const matchRanges = highlightText ? findExampleMatchRanges(text, highlightText) : [];
  const pinyinParts = getPinyinParts(text);

  // Build segments: group each Han char + its trailing non-Han chars (punctuation) together
  const chars = Array.from(text);
  const segments: {
    char: string;
    index: number;
    pinyin: string;
    isHan: boolean;
    matchKind: 'exact' | 'variant' | null;
  }[] = [];
  for (let i = 0; i < chars.length; i++) {
    const char = chars[i]!;
    const pinyinPart = pinyinParts[i] ?? '';
    const isHanChar = HAN_REGEX.test(char);
    const exactHighlighted = highlightedIndices.has(i);
    const matchKind = exactHighlighted ? 'exact' : getHighlightKindAtIndex(matchRanges, i);
    segments.push({ char, index: i, pinyin: pinyinPart, isHan: isHanChar, matchKind });
  }

  const result: React.ReactNode[] = [];
  let i = 0;
  while (i < segments.length) {
    const seg = segments[i]!;
    const { pinyin, isHan, matchKind } = seg;

    // Collect trailing non-Han chars (punctuation, spaces) to group with this segment
    let trailingNonHan = '';
    let j = i + 1;
    while (j < segments.length && !segments[j]!.isHan) {
      trailingNonHan += segments[j]!.char;
      j++;
    }

    const bgClassName =
      matchKind === 'exact'
        ? 'rounded bg-yellow-300/20 px-0.5 text-yellow-200'
        : matchKind === 'variant'
          ? 'rounded bg-cyan-300/20 px-0.5 text-cyan-200'
          : '';

    if (!isHan || !pinyin || pinyin === seg.char) {
      // Plain text without ruby
      result.push(
        <span key={`${seg.char}-${seg.index}`} className={bgClassName || undefined}>
          {seg.char}
          {trailingNonHan && <span>{trailingNonHan}</span>}
        </span>,
      );
    } else {
      // Ruby text with pinyin, followed by trailing non-Han chars grouped on same line
      result.push(
        <ruby
          key={`${seg.char}-${seg.index}`}
          className={`mx-[1px] inline-flex flex-col-reverse items-center leading-none ${bgClassName}`}
        >
          <span>{seg.char}</span>
          <rt className='mb-0.5 text-[0.6rem] font-medium text-cyan-200'>{pinyin}</rt>
        </ruby>,
      );
      if (trailingNonHan) {
        result.push(
          <span key={`trail-${seg.index}`} className={bgClassName || undefined}>
            {trailingNonHan}
          </span>,
        );
      }
    }

    // Skip over consumed trailing chars
    i = trailingNonHan ? j : i + 1;
  }

  return <span className={className}>{result}</span>;
}

export function HighlightedText({
  text,
  highlightText,
  className,
}: {
  text: string;
  highlightText?: string;
  className?: string;
}) {
  const ranges = highlightText ? findExampleMatchRanges(text, highlightText) : [];

  if (ranges.length === 0) {
    return <span className={className}>{text}</span>;
  }

  const segments: React.ReactNode[] = [];
  let cursor = 0;

  ranges.forEach((range, index) => {
    if (cursor < range.start) {
      segments.push(
        <span key={`plain-${index}-${cursor}`}>{text.slice(cursor, range.start)}</span>,
      );
    }

    const segmentClassName =
      range.kind === 'exact'
        ? 'rounded bg-yellow-300/20 px-0.5 text-yellow-200'
        : 'rounded bg-cyan-300/20 px-0.5 text-cyan-200';

    segments.push(
      <span key={`highlight-${index}-${range.start}`} className={segmentClassName}>
        {text.slice(range.start, range.end)}
      </span>,
    );
    cursor = range.end;
  });

  if (cursor < text.length) {
    segments.push(<span key={`plain-tail-${cursor}`}>{text.slice(cursor)}</span>);
  }

  return <span className={className}>{segments}</span>;
}
