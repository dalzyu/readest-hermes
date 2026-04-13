import type { NormalizedLookupResult } from './normalizer';

export type ValidationDecision = 'accept' | 'accept-with-warning' | 'degrade';

export interface ValidationResult {
  decision: ValidationDecision;
  reason?: string;
}

/**
 * Validates a normalized lookup result.
 *
 * Rules:
 * - degrade: the primary field (mode) is missing or empty
 * - accept-with-warning: translation exactly echoes selectedText AND selectedText.length > 1
 *   AND source language differs from target language (otherwise identical is expected for CJK
 *   single-char or same-script loanwords)
 * - accept: otherwise
 */
export function validateLookupResult(
  fields: NormalizedLookupResult,
  primaryField: string,
  selectedText?: string,
  sourceLanguage?: string,
  targetLanguage?: string,
): ValidationResult {
  const value = fields[primaryField];

  if (!value) {
    return { decision: 'degrade', reason: `${primaryField} field is empty or missing` };
  }

  // Skip echo warning when source and target are the same language, since identical
  // translations are expected for proper nouns, loanwords, and single-char CJK.
  const isSameLanguage =
    sourceLanguage !== undefined &&
    targetLanguage !== undefined &&
    sourceLanguage === targetLanguage;

  if (
    !isSameLanguage &&
    selectedText !== undefined &&
    value === selectedText &&
    selectedText.length > 1
  ) {
    return {
      decision: 'accept-with-warning',
      reason: 'Translation echoes the source text (possible proper noun or untranslated term)',
    };
  }

  return { decision: 'accept' };
}
