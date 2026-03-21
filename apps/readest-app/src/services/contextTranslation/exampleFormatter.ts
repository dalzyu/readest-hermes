import { pinyin } from 'pinyin-pro';
import type { LookupExample, TranslationOutputField, TranslationResult } from './types';
import { classifyExampleMatch } from './exampleMatcher';
import { getCJKLanguage, HAN_REGEX } from '@/app/reader/components/annotator/LookupPopupUtils';

type FormatRequest = {
  selectedText: string;
  sourceLanguage?: string;
  targetLanguage: string;
  outputFields: TranslationOutputField[];
  /** Page context (localPastContext) used to disambiguate Japanese vs Chinese when the selected text is pure kanji. */
  pageContext?: string;
};

const NUMBERED_EXAMPLE_REGEX = /^(\d+\.\s*)(.+)$/u;
const ENGLISH_LINE_REGEX = /^English:\s*/iu;
const PINYIN_LINE_REGEX = /^Pinyin:\s*/iu;
const CHINESE_LINE_REGEX = /^Chinese:\s*/iu;

function shouldFormatChineseExamples(request: FormatRequest, result: TranslationResult): boolean {
  return (
    !!result['examples'] &&
    request.outputFields.some((field) => field.enabled && field.id === 'examples') &&
    (request.sourceLanguage === 'zh' ||
      getCJKLanguage(request.selectedText, request.pageContext ?? '') === 'chinese')
  );
}

function shouldProcessExamples(request: FormatRequest, result: TranslationResult): boolean {
  return (
    !!result['examples'] &&
    request.outputFields.some((field) => field.enabled && field.id === 'examples')
  );
}

function toHanyuPinyin(text: string): string {
  return pinyin(text, {
    toneType: 'symbol',
    nonZh: 'removed',
    type: 'string',
  }).trim();
}

function normalizeExampleLayout(examples: string): string {
  return examples
    .replace(/\r\n?/g, '\n')
    .replace(/\s+(Pinyin:\s*)/giu, '\n$1')
    .replace(/\s+(English:\s*)/giu, '\n$1')
    .replace(/\s+(\d+\.\s)/gu, '\n\n$1')
    .trim();
}

function formatExampleBlock(
  blockLines: string[],
  selectedText: string,
  includePinyin: boolean,
): string {
  const trimmedLines = blockLines.map((line) => line.trim()).filter(Boolean);

  if (trimmedLines.length === 0) {
    return '';
  }

  const [firstLine, ...restLines] = trimmedLines;
  if (!firstLine) {
    return '';
  }
  const numberedMatch = NUMBERED_EXAMPLE_REGEX.exec(firstLine);

  if (!numberedMatch) {
    return trimmedLines.join('\n');
  }

  const chineseSentence = (numberedMatch[2] ?? '').trim();
  const match = classifyExampleMatch(chineseSentence, selectedText);
  if (match.kind === 'none') {
    return '';
  }
  const englishLine = restLines.find((line) => ENGLISH_LINE_REGEX.test(line));
  const extraLines = restLines.filter(
    (line) => !ENGLISH_LINE_REGEX.test(line) && !PINYIN_LINE_REGEX.test(line),
  );

  const formattedLines = [firstLine];

  if (includePinyin && HAN_REGEX.test(chineseSentence)) {
    const pinyinLine = toHanyuPinyin(chineseSentence);
    if (pinyinLine) {
      formattedLines.push(`Pinyin: ${pinyinLine}`);
    }
  }

  if (englishLine) {
    formattedLines.push(englishLine);
  }

  formattedLines.push(...extraLines);

  return formattedLines.join('\n');
}

function formatExamples(examples: string, request: FormatRequest): string {
  const normalizedExamples = normalizeExampleLayout(examples);
  if (!normalizedExamples) {
    return examples;
  }

  const blocks: string[][] = [];
  let currentBlock: string[] = [];

  for (const rawLine of normalizedExamples.split('\n')) {
    const line = rawLine.trimEnd();
    const trimmedLine = line.trim();

    if (!trimmedLine) {
      continue;
    }

    if (NUMBERED_EXAMPLE_REGEX.test(trimmedLine)) {
      if (currentBlock.length > 0) {
        blocks.push(currentBlock);
      }
      currentBlock = [trimmedLine];
      continue;
    }

    if (currentBlock.length === 0) {
      return normalizedExamples;
    }

    currentBlock.push(trimmedLine);
  }

  if (currentBlock.length > 0) {
    blocks.push(currentBlock);
  }

  return blocks
    .map((block) =>
      formatExampleBlock(
        block,
        request.selectedText,
        shouldFormatChineseExamples(request, { examples }),
      ),
    )
    .filter(Boolean)
    .join('\n\n');
}

export function formatTranslationResult(
  result: TranslationResult,
  request: FormatRequest,
): TranslationResult {
  const examples = result['examples'];

  if (!examples || !shouldProcessExamples(request, result)) {
    return result;
  }

  return {
    ...result,
    examples: formatExamples(examples, request),
  };
}

function stripNumbering(value: string): string {
  return value.replace(/^\d+\.\s*/, '').trim();
}

function stripLabel(value: string): string {
  return value.replace(ENGLISH_LINE_REGEX, '').replace(CHINESE_LINE_REGEX, '').trim();
}

export function parseStructuredExamples(value: string): LookupExample[] {
  return value
    .split(/\n{2,}/)
    .map((item) =>
      item
        .split('\n')
        .map((line) => line.trim())
        .filter(Boolean),
    )
    .map((lines, index) => {
      const [firstLine = ''] = lines;
      const englishLine = lines.find((line) => ENGLISH_LINE_REGEX.test(line));
      const chineseLine = lines.find((line) => CHINESE_LINE_REGEX.test(line));
      const unlabeledTargetLine =
        lines.find(
          (line, lineIndex) =>
            lineIndex > 0 &&
            !PINYIN_LINE_REGEX.test(line) &&
            !ENGLISH_LINE_REGEX.test(line) &&
            !CHINESE_LINE_REGEX.test(line),
        ) ?? '';
      const targetText = stripLabel(englishLine ?? chineseLine ?? unlabeledTargetLine);

      return {
        exampleId: `example-${index + 1}`,
        sourceText: stripNumbering(firstLine),
        targetText,
      };
    })
    .filter((example) => example.sourceText.length > 0 && example.targetText.length > 0);
}

export function filterRenderableExamples(
  examples: LookupExample[],
  selectedText: string,
): LookupExample[] {
  return examples.filter(
    (example) =>
      classifyExampleMatch(example.sourceText, selectedText).kind !== 'none' ||
      classifyExampleMatch(example.targetText, selectedText).kind !== 'none',
  );
}
