import type { TranslationOutputField, TranslationResult } from './types';

export interface StreamingParseResult {
  fields: TranslationResult;
  activeFieldId: string | null;
}

/**
 * Single-pass XML tag scanner: finds all matching field tags in the response
 * and extracts their content. Does not depend on field order matching response order.
 * Handles partial (incomplete) tags during streaming.
 */
function scanFieldsInDocumentOrder(
  response: string,
  fields: TranslationOutputField[],
): { fields: TranslationResult; activeFieldId: string | null } {
  const result: TranslationResult = {};
  const enabledIds = new Set(fields.filter((f) => f.enabled).map((f) => f.id));

  // Per-field extraction: handles partial tags during streaming
  for (const field of fields) {
    if (!enabledIds.has(field.id)) continue;

    const openTag = `<${field.id}>`;
    const closeTag = `</${field.id}>`;
    const openPos = response.indexOf(openTag);

    if (openPos === -1) continue;

    const contentStart = openPos + openTag.length;
    const closePos = response.indexOf(closeTag, contentStart);

    if (closePos !== -1) {
      // Complete tag pair
      result[field.id] = response.slice(contentStart, closePos).trim();
    } else {
      // Partial — streaming in progress
      result[field.id] = response.slice(contentStart).trim();
    }
  }

  // Determine active field: the field that has an opening tag but no closing tag yet.
  // If multiple fields are open, pick the one whose opening tag appears last.
  let activeFieldId: string | null = null;
  let latestOpenPos = -1;

  for (const id of fields.map((f) => f.id)) {
    if (result[id] === undefined) continue; // Field not started
    const closeTag = `</${id}>`;
    const closePos = response.indexOf(closeTag);
    if (closePos !== -1) continue; // Field is complete
    // Field is open (started but not closed)
    const openTag = `<${id}>`;
    const openPos = response.indexOf(openTag);
    if (openPos > latestOpenPos) {
      latestOpenPos = openPos;
      activeFieldId = id;
    }
  }

  return { fields: result, activeFieldId };
}

/**
 * Alias for the single-pass scanner — used for incremental streaming parsing.
 */
export function parseStreamingTranslationResponse(
  response: string,
  fields: TranslationOutputField[],
): StreamingParseResult {
  return scanFieldsInDocumentOrder(response, fields);
}

/**
 * Parses an LLM response that uses XML-style tags per output field.
 * Falls back to using the full response as the `translation` field value
 * when no tags are found.
 */
export function parseTranslationResponse(
  response: string,
  fields: TranslationOutputField[],
): TranslationResult {
  const { fields: parsed } = scanFieldsInDocumentOrder(response, fields);

  if (Object.keys(parsed).length > 0) {
    return parsed;
  }

  // No tags — treat entire response as the translation field
  const translationField = fields.find((f) => f.enabled && f.id === 'translation');
  if (translationField) {
    return { translation: response.trim() };
  }

  return {};
}
