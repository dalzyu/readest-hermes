import type { ContextLookupMode } from './modes';
import type { TranslationResult } from './types';

const LOOKUP_JSON_REGEX = /<lookup_json>([\s\S]*?)<\/lookup_json>/u;
const XML_TAG_REGEX = /<(\w+)>([\s\S]*?)<\/\1>/gu;

/** Final authoritative result from the LLM, keyed by field id. */
export type NormalizedLookupResult = TranslationResult;

/**
 * Extracts the <lookup_json>...</lookup_json> block from a raw LLM response.
 * Returns null if no sentinel block is found.
 */
function extractLookupJson(raw: string): Record<string, string> | null {
  const match = LOOKUP_JSON_REGEX.exec(raw);
  if (!match || !match[1]) return null;
  try {
    const parsed: unknown = JSON.parse(match[1].trim());
    if (typeof parsed === 'object' && parsed !== null) {
      // Ensure all leaf values are strings (LLM may return arrays for structured fields like sourceExamples)
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
  } catch {
    // malformed JSON — fall through to tag-based parser
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
 * 2. XML-tagged fields fallback
 * 3. Raw text as 'translation'
 */
export function normalizeLookupResponse(
  raw: string,
  mode: ContextLookupMode,
): NormalizedLookupResult {
  const json = extractLookupJson(raw);
  if (json) return json as NormalizedLookupResult;
  return normalizeTaggedFallback(raw, mode);
}
