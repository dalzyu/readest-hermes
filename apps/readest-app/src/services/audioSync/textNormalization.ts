const COLLAPSIBLE_WHITESPACE = /[\s\u00A0]+/g;
const WHITESPACE_FRAGMENT = /^[\s\u00A0]+$/u;
const FOOTNOTE_LINK_PATTERN = /^[\[(]?\s*[*\divxlcdm]+\s*[\])]?$|^\*+$/i;
const REJECT_ANCESTOR_TAGS = new Set(['script', 'style', 'noscript', 'rt']);
const CHARACTER_NORMALIZATIONS = new Map<string, string>([
  ['‘', "'"],
  ['’', "'"],
  ['‛', "'"],
  ['“', '"'],
  ['”', '"'],
  ['„', '"'],
  ['‟', '"'],
  ['–', '-'],
  ['—', '-'],
  ['…', '...'],
]);
const TOKEN_RE =
  /[\u3040-\u30ff\u3400-\u4dbf\u4e00-\u9fff\uf900-\ufaff\uac00-\ud7af]|[\p{L}\p{N}]+(?:['-][\p{L}\p{N}]+)*|[^\s\p{L}\p{N}]+/gu;
const WORD_TOKEN_RE = /^(?:[\p{L}\p{N}]+(?:['-][\p{L}\p{N}]+)*)$/u;
const CJK_CHAR_RE = /^[\u3040-\u30ff\u3400-\u4dbf\u4e00-\u9fff\uf900-\ufaff\uac00-\ud7af]$/u;

export type CanonicalTextTokenKind = 'word' | 'punctuation' | 'cjkCharacter';

export interface NormalizedCanonicalTextToken {
  normalizedStart: number;
  normalizedEnd: number;
  originalStart: number;
  originalEnd: number;
  text: string;
  kind: CanonicalTextTokenKind;
}

export interface NormalizedCanonicalText {
  text: string;
  tokens: NormalizedCanonicalTextToken[];
}

function hasNoterefSemantics(element: Element): boolean {
  const role = element.getAttribute('role') || '';
  const epubType = element.getAttribute('epub:type') || element.getAttribute('type') || '';
  return role.includes('doc-noteref') || /(^|\s)noteref(\s|$)/i.test(epubType);
}

function normalizeCanonicalCharacter(char: string): string {
  if (/[\u0000-\u001f]/u.test(char)) {
    return ' ';
  }
  return CHARACTER_NORMALIZATIONS.get(char) ?? char;
}

function classifyCanonicalToken(text: string): CanonicalTextTokenKind {
  if (text.length === 1 && CJK_CHAR_RE.test(text)) {
    return 'cjkCharacter';
  }
  if (WORD_TOKEN_RE.test(text)) {
    return 'word';
  }
  return 'punctuation';
}

export function tokenizeCanonicalText(text: string): NormalizedCanonicalText {
  const normalizedChars: Array<{ char: string; originalStart: number; originalEnd: number }> = [];
  let originalOffset = 0;
  let pendingWhitespace: { start: number; end: number } | null = null;

  for (const rawChar of text) {
    const nextOriginalOffset = originalOffset + rawChar.length;
    const normalized = normalizeCanonicalCharacter(rawChar);

    if (WHITESPACE_FRAGMENT.test(normalized)) {
      pendingWhitespace = pendingWhitespace
        ? { start: pendingWhitespace.start, end: nextOriginalOffset }
        : { start: originalOffset, end: nextOriginalOffset };
      originalOffset = nextOriginalOffset;
      continue;
    }

    if (pendingWhitespace && normalizedChars.length > 0) {
      normalizedChars.push({
        char: ' ',
        originalStart: pendingWhitespace.start,
        originalEnd: pendingWhitespace.end,
      });
    }
    pendingWhitespace = null;

    for (let index = 0; index < normalized.length; index += 1) {
      normalizedChars.push({
        char: normalized[index]!,
        originalStart: originalOffset,
        originalEnd: nextOriginalOffset,
      });
    }

    originalOffset = nextOriginalOffset;
  }

  const normalizedText = normalizedChars.map((entry) => entry.char).join('');
  const tokens = Array.from(normalizedText.matchAll(TOKEN_RE)).map((match) => {
    const start = match.index ?? 0;
    const tokenText = match[0];
    const end = start + tokenText.length;
    const startChar = normalizedChars[start]!;
    const endChar = normalizedChars[end - 1]!;

    return {
      normalizedStart: start,
      normalizedEnd: end,
      originalStart: startChar.originalStart,
      originalEnd: endChar.originalEnd,
      text: tokenText,
      kind: classifyCanonicalToken(tokenText),
    };
  });

  return {
    text: normalizedText,
    tokens,
  };
}

export function normalizeCanonicalText(text: string): string {
  return tokenizeCanonicalText(text).text.replace(COLLAPSIBLE_WHITESPACE, ' ').trim();
}

export function shouldIgnoreCanonicalTextNode(node: Text): boolean {
  const original = node.textContent || '';
  const normalized = normalizeCanonicalText(original);
  if (!normalized) {
    return true;
  }

  let current: Element | null = node.parentElement;
  while (current) {
    const tag = current.tagName.toLowerCase();
    if (REJECT_ANCESTOR_TAGS.has(tag)) {
      return true;
    }
    if (current.hasAttribute('cfi-inert')) {
      return true;
    }
    if (hasNoterefSemantics(current) && FOOTNOTE_LINK_PATTERN.test(normalized)) {
      return true;
    }
    if (tag === 'a' && FOOTNOTE_LINK_PATTERN.test(normalized)) {
      return true;
    }
    current = current.parentElement;
  }

  return false;
}
