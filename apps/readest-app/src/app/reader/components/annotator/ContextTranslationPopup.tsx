import React from 'react';
import { pinyin } from 'pinyin-pro';
import { PiInfo } from 'react-icons/pi';
import { RiBookmarkFill, RiBookmarkLine, RiVolumeUpLine } from 'react-icons/ri';
import Popup from '@/components/Popup';
import { eventDispatcher } from '@/utils/event';
import { useContextTranslation } from '@/hooks/useContextTranslation';
import useOpenAIInNotebook from '@/app/reader/hooks/useOpenAIInNotebook';
import { useTranslation } from '@/hooks/useTranslation';
import type {
  ContextTranslationSettings,
  PopupContextBundle,
  PopupRetrievalHints,
  RetrievalStatus,
  TranslationResult,
} from '@/services/contextTranslation/types';
import {
  classifyExampleMatch,
  findExampleMatchRanges,
  type ExampleMatchRange,
} from '@/services/contextTranslation/exampleMatcher';
import { Position } from '@/utils/sel';

interface ContextTranslationPopupProps {
  bookKey: string;
  bookHash: string;
  selectedText: string;
  currentPage: number;
  settings: ContextTranslationSettings;
  position: Position;
  trianglePosition: Position;
  popupWidth: number;
  popupHeight: number;
  onDismiss?: () => void;
}

interface ParsedExampleItem {
  sourceLine: string;
  englishLine: string | null;
  chineseLine: string | null;
  extraLines: string[];
}

const HAN_REGEX = /[\u3400-\u9fff]/u;
const PINYIN_LINE_REGEX = /^Pinyin:\s*/iu;
const ENGLISH_LINE_REGEX = /^English:\s*/iu;
const CHINESE_LINE_REGEX = /^Chinese:\s*/iu;

function isChineseText(value: string): boolean {
  return HAN_REGEX.test(value);
}

function getPinyinLabel(value: string): string {
  return pinyin(value, {
    toneType: 'symbol',
    type: 'string',
    nonZh: 'removed',
  }).trim();
}

function getPinyinParts(value: string): string[] {
  return pinyin(value, {
    toneType: 'symbol',
    type: 'array',
  });
}

function getHighlightedIndices(value: string, highlightText: string): Set<number> {
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

function getHighlightKindAtIndex(
  ranges: ExampleMatchRange[],
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

function RubyText({
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

  return (
    <span className={className}>
      {Array.from(text).map((char, index) => {
        const pinyinPart = pinyinParts[index] ?? '';
        const isHanChar = HAN_REGEX.test(char);
        const exactHighlighted = highlightedIndices.has(index);
        const matchKind = exactHighlighted ? 'exact' : getHighlightKindAtIndex(matchRanges, index);
        const textClassName =
          matchKind === 'exact'
            ? 'rounded bg-yellow-300/20 px-0.5 text-yellow-200'
            : matchKind === 'variant'
              ? 'rounded bg-cyan-300/20 px-0.5 text-cyan-200'
              : undefined;

        if (!isHanChar || !pinyinPart || pinyinPart === char) {
          return (
            <span key={`${char}-${index}`} className={textClassName}>
              {char}
            </span>
          );
        }

        return (
          <ruby
            key={`${char}-${index}`}
            className={`mx-[1px] inline-flex flex-col-reverse items-center leading-none ${
              matchKind === 'exact'
                ? 'rounded bg-yellow-300/20 px-0.5 text-yellow-200'
                : matchKind === 'variant'
                  ? 'rounded bg-cyan-300/20 px-0.5 text-cyan-200'
                  : ''
            }`}
          >
            <span>{char}</span>
            <rt className='mb-0.5 text-[0.6rem] font-medium text-cyan-200'>{pinyinPart}</rt>
          </ruby>
        );
      })}
    </span>
  );
}

function HighlightedText({
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

function parseExampleItems(value: string): string[] {
  return value
    .split(/\n{2,}/)
    .map((item) => item.trim())
    .filter(Boolean);
}

function stripExampleNumbering(value: string): string {
  return value.replace(/^\d+\.\s*/, '');
}

function parseExampleItem(item: string): ParsedExampleItem {
  const lines = item
    .split('\n')
    .map((line) => line.trim())
    .filter(Boolean);
  const [firstLine = ''] = lines;
  const sourceLine = stripExampleNumbering(firstLine);
  const englishLine = lines.find((line) => ENGLISH_LINE_REGEX.test(line)) ?? null;
  const chineseLine =
    lines.find((line) => CHINESE_LINE_REGEX.test(line)) ??
    lines.find(
      (line, index) =>
        index > 0 &&
        !PINYIN_LINE_REGEX.test(line) &&
        !ENGLISH_LINE_REGEX.test(line) &&
        HAN_REGEX.test(line),
    ) ??
    null;

  return {
    sourceLine,
    englishLine,
    chineseLine,
    extraLines: lines.filter(
      (line, index) =>
        index > 0 && !PINYIN_LINE_REGEX.test(line) && line !== englishLine && line !== chineseLine,
    ),
  };
}

function hasRenderableExampleMatch(item: string, selectedText: string): boolean {
  const parsedItem = parseExampleItem(item);
  const candidates = [
    parsedItem.sourceLine,
    parsedItem.chineseLine?.replace(CHINESE_LINE_REGEX, ''),
    parsedItem.englishLine?.replace(ENGLISH_LINE_REGEX, ''),
  ].filter(Boolean);

  return candidates
    .filter((c): c is string => c !== undefined)
    .some((candidate) => classifyExampleMatch(candidate, selectedText).kind !== 'none');
}

function formatVolumeList(values: number[]): string {
  if (values.length === 0) return '';
  return values.join(', ');
}

function getRetrievalStatusMeta(status: RetrievalStatus): { label: string; className: string } {
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

function buildRetrievalInfoText(status: RetrievalStatus, hints: PopupRetrievalHints): string {
  if (status === 'local-only') {
    if (hints.missingLocalIndex) {
      return hints.missingPriorVolumes.length > 0
        ? `Index this volume first. Then index volumes ${formatVolumeList(
            hints.missingPriorVolumes,
          )} to enable cross-volume context.`
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
      return `Index volumes ${formatVolumeList(
        hints.missingPriorVolumes,
      )} to enable cross-volume context.`;
    }
  }

  if (hints.missingPriorVolumes.length > 0) {
    return `Earlier volume retrieval is active. Index volumes ${formatVolumeList(
      hints.missingPriorVolumes,
    )} for fuller cross-volume context.`;
  }

  return 'This lookup is using recent local context, earlier same-book memory, and prior-volume memory.';
}

function buildAskAboutThisMessage(
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

const ContextTranslationPopup: React.FC<ContextTranslationPopupProps> = ({
  bookKey,
  bookHash,
  selectedText,
  currentPage,
  settings,
  position,
  trianglePosition,
  popupWidth,
  popupHeight,
  onDismiss,
}) => {
  const _ = useTranslation();
  const { openAIInNotebook } = useOpenAIInNotebook();
  const [saved, setSaved] = React.useState(false);

  const {
    result,
    partialResult,
    loading,
    streaming,
    activeFieldId,
    error,
    retrievalStatus,
    retrievalHints,
    popupContext,
    saveToVocabulary,
  } = useContextTranslation({
    bookKey,
    bookHash,
    selectedText,
    currentPage,
    settings,
  });

  const enabledFields = settings.outputFields
    .filter((field) => field.enabled)
    .sort((a, b) => a.order - b.order);
  const displayedResult = result ?? partialResult ?? {};
  const hasDisplayedResult = Object.keys(displayedResult).length > 0;
  const selectedTextPinyin = isChineseText(selectedText) ? getPinyinLabel(selectedText) : '';
  const retrievalStatusMeta = getRetrievalStatusMeta(retrievalStatus);
  const retrievalInfoText = buildRetrievalInfoText(retrievalStatus, retrievalHints);

  const handleSpeak = () => {
    eventDispatcher.dispatch('tts-speak', {
      bookKey,
      text: selectedText,
      oneTime: true,
    });
  };

  const handleSave = async () => {
    await saveToVocabulary();
    setSaved(true);
  };

  const handleAskAboutThis = async () => {
    if (!result || !popupContext) return;

    await openAIInNotebook({
      bookHash,
      newConversationTitle: `Ask about ${selectedText}`,
      firstMessageContent: buildAskAboutThisMessage(selectedText, result, popupContext),
    });
  };

  return (
    <div>
      <Popup
        trianglePosition={trianglePosition}
        width={popupWidth}
        minHeight={popupHeight}
        maxHeight={480}
        position={position}
        className='not-eink:text-white flex flex-col bg-gray-700'
        triangleClassName='text-gray-700'
        onDismiss={onDismiss}
      >
        <div className='flex items-center justify-between border-b border-gray-500/30 px-4 py-3'>
          <div className='flex min-w-0 flex-col gap-2'>
            <span className='not-eink:text-yellow-300 flex min-w-0 select-text items-center gap-2 font-medium'>
              <button
                type='button'
                onClick={handleSpeak}
                title={_('Speak')}
                className='flex-shrink-0 text-green-200/70 transition-colors hover:text-green-100'
                aria-label={_('Speak')}
              >
                <RiVolumeUpLine size={16} />
              </button>
              <span className='line-clamp-1'>{selectedText}</span>
              {selectedTextPinyin ? (
                <span className='truncate text-sm font-normal text-cyan-200'>
                  {selectedTextPinyin}
                </span>
              ) : null}
            </span>
            <div className='flex items-center gap-2'>
              <span
                className={`inline-flex items-center rounded-full border px-2 py-0.5 text-[11px] font-medium ${retrievalStatusMeta.className}`}
              >
                {_(retrievalStatusMeta.label)}
              </span>
              <button
                type='button'
                title={_(retrievalInfoText)}
                className='text-gray-300 transition-colors hover:text-white'
                aria-label={_('Retrieval context info')}
              >
                <PiInfo size={14} />
              </button>
            </div>
          </div>
          <div className='flex items-center gap-2'>
            <button
              type='button'
              onClick={handleAskAboutThis}
              disabled={!result || streaming || !popupContext}
              className='rounded-full border border-cyan-400/40 px-3 py-1 text-xs font-medium text-cyan-200 transition-colors hover:border-cyan-300 hover:text-cyan-100 disabled:opacity-40'
            >
              {_('Ask About This')}
            </button>
            <button
              onClick={handleSave}
              disabled={!result || streaming || saved}
              title={saved ? _('Saved') : _('Save to vocabulary')}
              className='text-gray-400 transition-colors hover:text-yellow-300 disabled:opacity-40'
            >
              {saved ? <RiBookmarkFill size={18} /> : <RiBookmarkLine size={18} />}
            </button>
          </div>
        </div>

        <div className='flex flex-1 flex-col gap-3 overflow-y-auto p-4'>
          {loading && !hasDisplayedResult && (
            <p className='text-sm italic text-gray-400'>{_('Translating...')}</p>
          )}
          {error && <p className='text-sm text-red-400'>{error}</p>}
          {!error &&
            (hasDisplayedResult || !loading) &&
            enabledFields.map((field) => {
              const value = displayedResult[field.id] ?? '';
              const isActive = streaming && activeFieldId === field.id;
              const exampleItems =
                field.id === 'examples' && value
                  ? parseExampleItems(value).filter((item) =>
                      hasRenderableExampleMatch(item, selectedText),
                    )
                  : [];

              return (
                <div key={field.id}>
                  <h3 className='mb-1 text-xs font-medium uppercase tracking-wide text-gray-400'>
                    {_(field.label)}
                  </h3>
                  {field.id === 'examples' && exampleItems.length > 0 ? (
                    <ol className='not-eink:text-white/90 select-text list-decimal space-y-4 pl-5 text-sm leading-relaxed'>
                      {exampleItems.map((item, index) => {
                        const parsedExample = parseExampleItem(item);
                        const sourceIsChinese = isChineseText(parsedExample.sourceLine);

                        return (
                          <li key={`${field.id}-${index}`} className='space-y-2'>
                            {parsedExample.sourceLine ? (
                              <div className='leading-8'>
                                {sourceIsChinese ? (
                                  <RubyText
                                    text={parsedExample.sourceLine}
                                    highlightText={selectedText}
                                    className='not-eink:text-white/95'
                                  />
                                ) : (
                                  <HighlightedText
                                    text={parsedExample.sourceLine}
                                    highlightText={selectedText}
                                    className='not-eink:text-white/95'
                                  />
                                )}
                              </div>
                            ) : null}
                            {parsedExample.englishLine ? (
                              <p className='whitespace-pre-wrap text-white/80'>
                                {parsedExample.englishLine}
                              </p>
                            ) : null}
                            {parsedExample.chineseLine ? (
                              <div className='leading-8 text-white/80'>
                                {CHINESE_LINE_REGEX.test(parsedExample.chineseLine) ? (
                                  <>
                                    <span>Chinese: </span>
                                    <RubyText
                                      text={parsedExample.chineseLine.replace(
                                        CHINESE_LINE_REGEX,
                                        '',
                                      )}
                                      className='not-eink:text-white/90'
                                    />
                                  </>
                                ) : (
                                  <RubyText
                                    text={parsedExample.chineseLine}
                                    className='not-eink:text-white/90'
                                  />
                                )}
                              </div>
                            ) : null}
                            {parsedExample.extraLines.map((line, lineIndex) => (
                              <p
                                key={`${field.id}-${index}-${lineIndex}`}
                                className='whitespace-pre-wrap text-white/80'
                              >
                                {line}
                              </p>
                            ))}
                            {isActive && index === exampleItems.length - 1 ? (
                              <span className='ml-1 animate-pulse'>|</span>
                            ) : null}
                          </li>
                        );
                      })}
                    </ol>
                  ) : (
                    <p className='not-eink:text-white/90 select-text whitespace-pre-wrap text-sm leading-relaxed'>
                      {value || (streaming ? _('Waiting...') : '')}
                      {isActive ? <span className='ml-1 animate-pulse'>|</span> : null}
                    </p>
                  )}
                </div>
              );
            })}
        </div>
      </Popup>
    </div>
  );
};

export default ContextTranslationPopup;
