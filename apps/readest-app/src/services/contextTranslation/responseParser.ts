import type { TranslationOutputField, TranslationResult } from './types';

export interface StreamingParseResult {
  fields: TranslationResult;
  activeFieldId: string | null;
}

function getEnabledFields(fields: TranslationOutputField[]): TranslationOutputField[] {
  return fields.filter((f) => f.enabled).sort((a, b) => a.order - b.order);
}

export function parseStreamingTranslationResponse(
  response: string,
  fields: TranslationOutputField[],
): StreamingParseResult {
  const result: TranslationResult = {};
  const enabledFields = getEnabledFields(fields);
  let activeFieldId: string | null = null;

  for (const field of enabledFields) {
    const startTag = `<${field.id}>`;
    const endTag = `</${field.id}>`;
    const startIndex = response.indexOf(startTag);

    if (startIndex === -1) continue;

    const contentStart = startIndex + startTag.length;
    const endIndex = response.indexOf(endTag, contentStart);
    const content =
      endIndex === -1
        ? response.slice(contentStart)
        : response.slice(contentStart, endIndex);

    result[field.id] = content.trim();

    if (endIndex === -1) {
      activeFieldId = field.id;
    }
  }

  return { fields: result, activeFieldId };
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
  const enabledFields = getEnabledFields(fields);
  const parsed = parseStreamingTranslationResponse(response, fields);

  if (Object.keys(parsed.fields).length > 0) {
    return parsed.fields;
  }

  // No tags — treat entire response as the translation field
  const translationField = enabledFields.find((f) => f.id === 'translation');
  if (translationField) {
    return { translation: response.trim() };
  }

  return {};
}
