import { pinyin } from 'pinyin-pro';
import type { LookupExample, TranslationOutputField, TranslationResult } from './types';
import { classifyExampleMatch } from './exampleMatcher';
import { getCJKLanguage, HAN_REGEX } from '@/services/contextTranslation/utils';

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

/** Returns which example field is present in the result ('examples' | 'sourceExamples' | null) */
function getExampleField(result: TranslationResult): 'examples' | 'sourceExamples' | null {
  if (result['examples']) return 'examples';
  if (result['sourceExamples']) return 'sourceExamples';
  return null;
}

function shouldFormatChineseExamples(request: FormatRequest, result: TranslationResult): boolean {
  const field = getExampleField(result);
  if (!field) return false;
  const hasExamples = request.outputFields.some((f) => f.enabled && f.id === field);
  if (!hasExamples) return false;
  return (
    request.sourceLanguage === 'zh' ||
    getCJKLanguage(request.selectedText, request.pageContext ?? '') === 'chinese'
  );
}

function shouldProcessExamples(request: FormatRequest, result: TranslationResult): boolean {
  const field = getExampleField(result);
  return field !== null && request.outputFields.some((f) => f.enabled && f.id === field);
}

function toHanyuPinyin(text: string): string {
  return pinyin(text, {
    toneType: 'symbol',
    nonZh: 'removed',
    type: 'string',
  }).trim();
}

/**
 * Normalizes LLM example output by:
 * 1. Converting line endings to \n
 * 2. Forcing whitespace before label keywords (Pinyin:, English:, Chinese:) even when LLM omits it
 * 3. Separating numbered examples with blank lines
 *
 * Handles cases like:
 * - `中文句子English: xxx` → `中文句子\nEnglish: xxx`  (no space before English)
 * - `中文句子 English: xxx` → `中文句子\nEnglish: xxx` (space before English)
 * - `1. 中文句子 English: xxx` → `\n1. 中文句子\nEnglish: xxx` (number separated)
 */
function normalizeExampleLayout(examples: string): string {
  return (
    examples
      .replace(/\r\n?/g, '\n')
      // Force newline before Pinyin: even without preceding whitespace
      .replace(/([^\n])Pinyin:\s*/gu, '$1\nPinyin: ')
      .replace(/^Pinyin:\s*/gu, 'Pinyin: ')
      // Force newline before English: even without preceding whitespace
      .replace(/([^\n])English:\s*/gu, '$1\nEnglish: ')
      .replace(/^English:\s*/gu, 'English: ')
      // Force newline before Chinese: even without preceding whitespace
      .replace(/([^\n])Chinese:\s*/gu, '$1\nChinese: ')
      .replace(/^Chinese:\s*/gu, 'Chinese: ')
      // Separate numbered examples with blank lines
      .replace(/\s*(\d+\.\s)/gu, '\n\n$1')
      .trim()
  );
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

/**
 * Formats example fields in a lookup result for both translation mode (examples)
 * and dictionary mode (sourceExamples). Applies Chinese layout normalization
 * so that parseStructuredExamples can reliably split them.
 */
export function formatTranslationResult(
  result: TranslationResult,
  request: FormatRequest,
): TranslationResult {
  if (!shouldProcessExamples(request, result)) {
    return result;
  }

  // Apply formatting to whichever example field is present
  const examples = result['examples'];
  const sourceExamples = result['sourceExamples'];

  return {
    ...result,
    ...(examples ? { examples: formatExamples(examples, request) } : {}),
    ...(sourceExamples ? { sourceExamples: formatExamples(sourceExamples, request) } : {}),
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
