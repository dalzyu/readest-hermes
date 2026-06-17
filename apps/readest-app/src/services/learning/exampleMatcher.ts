export type ExampleMatchKind = 'exact' | 'variant' | 'none';

export interface ExampleMatchResult {
  kind: ExampleMatchKind;
  matchedText: string | null;
}

export interface ExampleMatchRange {
  start: number;
  end: number;
  kind: Exclude<ExampleMatchKind, 'none'>;
}

const TOKEN_REGEX = /[\p{L}\p{N}]+/gu;
const STRIP_REGEX = /[\s\p{P}\p{S}]+/gu;

function normalizeValue(value: string): string {
  return value.normalize('NFKC');
}

function stripForLooseMatch(value: string): string {
  return normalizeValue(value).toLowerCase().replace(STRIP_REGEX, '');
}

function stemToken(token: string): string {
  const lower = normalizeValue(token).toLowerCase();
  const withoutPossessive = lower.replace(/('s|s')$/u, '');

  if (withoutPossessive.length > 5 && withoutPossessive.endsWith('ing')) {
    return withoutPossessive.slice(0, -3);
  }
  if (withoutPossessive.length > 4 && withoutPossessive.endsWith('ied')) {
    return `${withoutPossessive.slice(0, -3)}y`;
  }
  if (withoutPossessive.length > 4 && withoutPossessive.endsWith('ed')) {
    return withoutPossessive.slice(0, -2);
  }
  if (withoutPossessive.length > 4 && withoutPossessive.endsWith('es')) {
    return withoutPossessive.slice(0, -2);
  }
  if (withoutPossessive.length > 3 && withoutPossessive.endsWith('s')) {
    return withoutPossessive.slice(0, -1);
  }

  return withoutPossessive;
}

function findExactRanges(example: string, selectedText: string): ExampleMatchRange[] {
  const ranges: ExampleMatchRange[] = [];
  let fromIndex = 0;

  while (selectedText && fromIndex < example.length) {
    const index = example.indexOf(selectedText, fromIndex);
    if (index === -1) break;
    ranges.push({ start: index, end: index + selectedText.length, kind: 'exact' });
    fromIndex = index + selectedText.length;
  }

  return ranges;
}

function findLooseNormalizedRange(example: string, selectedText: string): ExampleMatchRange | null {
  const normalizedSelected = stripForLooseMatch(selectedText);
  if (!normalizedSelected) return null;

  const chars = Array.from(example);
  const normalizedChars: { originalIndex: number; char: string }[] = [];

  chars.forEach((char, index) => {
    const normalizedChar = stripForLooseMatch(char);
    if (!normalizedChar) return;
    normalizedChars.push({ originalIndex: index, char: normalizedChar });
  });

  const normalizedExample = normalizedChars.map((item) => item.char).join('');
  const normalizedIndex = normalizedExample.indexOf(normalizedSelected);
  if (normalizedIndex === -1) return null;

  const start = normalizedChars[normalizedIndex]?.originalIndex;
  const endItem = normalizedChars[normalizedIndex + normalizedSelected.length - 1];
  if (start == null || !endItem) return null;

  return {
    start,
    end: endItem.originalIndex + 1,
    kind: 'variant',
  };
}

function findStemVariantRanges(example: string, selectedText: string): ExampleMatchRange[] {
  const selectedStem = stemToken(selectedText);
  if (!selectedStem || selectedStem.length < 3) return [];

  const ranges: ExampleMatchRange[] = [];
  for (const match of example.matchAll(TOKEN_REGEX)) {
    const token = match[0];
    const index = match.index;
    if (index == null) continue;
    if (stripForLooseMatch(token) === stripForLooseMatch(selectedText)) continue;
    if (stemToken(token) !== selectedStem) continue;
    ranges.push({ start: index, end: index + token.length, kind: 'variant' });
  }

  return ranges;
}

export function findExampleMatchRanges(example: string, selectedText: string): ExampleMatchRange[] {
  if (!example || !selectedText) return [];

  const exactRanges = findExactRanges(example, selectedText);
  if (exactRanges.length > 0) return exactRanges;

  const normalizedRange = findLooseNormalizedRange(example, selectedText);
  if (normalizedRange) return [normalizedRange];

  return findStemVariantRanges(example, selectedText);
}

export function classifyExampleMatch(example: string, selectedText: string): ExampleMatchResult {
  const ranges = findExampleMatchRanges(example, selectedText);
  if (ranges.length === 0) {
    return { kind: 'none', matchedText: null };
  }

  const [firstRange] = ranges;
  if (!firstRange) {
    return { kind: 'none', matchedText: null };
  }

  return {
    kind: firstRange.kind,
    matchedText: example.slice(firstRange.start, firstRange.end),
  };
}
