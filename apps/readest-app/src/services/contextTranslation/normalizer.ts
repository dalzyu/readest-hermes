import type { ContextLookupMode } from './modes';
import type { TranslationResult } from './types';

const LOOKUP_JSON_REGEX = /<lookup_json>([\s\S]*?)<\/lookup_json>/u;
const XML_TAG_REGEX = /<(\w+)>([\s\S]*?)<\/\1>/gu;

/** Final authoritative result from the LLM, keyed by field id. */
export type NormalizedLookupResult = TranslationResult;

/**
 * Converts a parsed JSON object into string-key/string-value lookup fields.
 */
function normalizeParsedObject(parsed: unknown): Record<string, string> | null {
  if (typeof parsed !== 'object' || parsed === null || Array.isArray(parsed)) return null;
  const stringified: Record<string, string> = {};
  for (const [key, value] of Object.entries(parsed as Record<string, unknown>)) {
    if (Array.isArray(value)) {
      // Join array elements with double-newline so parseStructuredExamples can split them into separate examples
      stringified[key] = value
        .map((v) => (typeof v === 'string' ? v.trim() : JSON.stringify(v)))
        .filter(Boolean)
        .join('\n\n');
    } else if (typeof value === 'string') {
      stringified[key] = value;
    } else {
      stringified[key] = JSON.stringify(value);
    }
  }
  return stringified;
}

function parseJsonCandidate(candidate: string): Record<string, string> | null {
  try {
    return normalizeParsedObject(JSON.parse(candidate));
  } catch {
    return null;
  }
}

/**
 * Extracts the <lookup_json>...</lookup_json> block from a raw LLM response.
 * Returns null if no sentinel block is found.
 */
function extractLookupJson(raw: string): Record<string, string> | null {
  const match = LOOKUP_JSON_REGEX.exec(raw);
  if (!match || !match[1]) return null;
  return parseJsonCandidate(match[1].trim());
}

/**
 * Extracts plain JSON object responses without requiring <lookup_json> sentinel.
 * Handles three common formats from local/quantized models:
 * 1) raw object text, 2) fenced ```json blocks, 3) prose wrapped around one object.
 */
function extractLooseJsonObject(raw: string): Record<string, string> | null {
  const trimmed = raw.trim();
  if (!trimmed) return null;

  const candidates = new Set<string>([trimmed]);

  const fencedRegex = /```(?:json)?\s*([\s\S]*?)```/giu;
  for (const match of trimmed.matchAll(fencedRegex)) {
    if (match[1]) candidates.add(match[1].trim());
  }

  const firstBrace = trimmed.indexOf('{');
  const lastBrace = trimmed.lastIndexOf('}');
  if (firstBrace !== -1 && lastBrace > firstBrace) {
    candidates.add(trimmed.slice(firstBrace, lastBrace + 1).trim());
  }

  for (const candidate of candidates) {
    const parsed = parseJsonCandidate(candidate);
    if (parsed) return parsed;
  }
  return null;
}

/**
 * Parses XML-tagged fields from a raw LLM response as a fallback.
 * e.g. <translation>bonjour</translation> → { translation: 'bonjour' }
 * Falls back to raw text as 'translation' when no tags are found.
 */
function normalizeTaggedFallback(raw: string, _mode: ContextLookupMode): NormalizedLookupResult {
  const result: NormalizedLookupResult = {};
  let match: RegExpExecArray | null;

  XML_TAG_REGEX.lastIndex = 0;
  while ((match = XML_TAG_REGEX.exec(raw)) !== null) {
    const fieldId = match[1];
    const content = match[2];
    if (fieldId && content !== undefined) {
      result[fieldId] = content.trim();
    }
  }

  if (Object.keys(result).length === 0) {
    result['translation'] = raw.trim();
  }

  return result;
}

/**
 * Normalizes a raw LLM response into a structured lookup result.
 *
 * Priority:
 * 1. <lookup_json>…</lookup_json> sentinel block (authoritative final parse)
 * 2. Plain/fenced JSON object fallback (model-agnostic)
 * 3. XML-tagged fields fallback
 * 4. Raw text as 'translation'
 */
export function normalizeLookupResponse(
  raw: string,
  mode: ContextLookupMode,
): NormalizedLookupResult {
  const json = extractLookupJson(raw);
  if (json) return json as NormalizedLookupResult;
  const looseJson = extractLooseJsonObject(raw);
  if (looseJson) return looseJson as NormalizedLookupResult;
  return normalizeTaggedFallback(raw, mode);
}
