import { resolveContextTranslationHarnessSettings } from './defaults';
import type { ContextTranslationHarnessSettings, TranslationResult } from './types';

function escapeRegexLiteral(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

function buildMarkerRegex(
  markers: string[],
  options: { prefixOnly?: boolean } = {},
): RegExp | null {
  if (markers.length === 0) return null;
  const body = markers.map((marker) => escapeRegexLiteral(marker.trim())).filter(Boolean).join('|');
  if (!body) return null;
  return options.prefixOnly ? new RegExp(`^\\s*(?:${body})`, 'i') : new RegExp(body, 'i');
}

function normalizeWhitespace(value: string): string {
  return value
    .replace(/\r\n/g, '\n')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}

function extractNestedFieldValue(fieldId: string, value: string): string | null {
  const match = new RegExp(`<${fieldId}>([\\s\\S]*?)<\\/${fieldId}>`, 'i').exec(value);
  return match?.[1]?.trim() || null;
}

function extractChannelTail(value: string): string | null {
  const marker = '<channel|>';
  const index = value.lastIndexOf(marker);
  if (index === -1) return null;
  const tail = value.slice(index + marker.length).trim();
  return tail || null;
}

function isLikelyReasoningLine(line: string, harness: ContextTranslationHarnessSettings): boolean {
  const trimmed = line.trim();
  if (!trimmed) return true;
  const metaLineRegex = buildMarkerRegex(harness.reasoningMarkers, { prefixOnly: true });
  if (metaLineRegex?.test(trimmed)) return true;
  if (/^\d+\.\s/.test(trimmed) && /analy|request|context|goal|task|draft|polish/i.test(trimmed)) {
    return true;
  }
  return false;
}

function isLikelyFinalContentLine(
  fieldId: string,
  line: string,
  harness: ContextTranslationHarnessSettings,
): boolean {
  const trimmed = line.trim();
  if (!trimmed) return false;
  if (isLikelyReasoningLine(trimmed, harness)) return false;

  if (fieldId === 'examples') {
    const metaPrefixRegex = buildMarkerRegex(harness.reasoningMarkers, { prefixOnly: true });
    return /^\d+\.\s/.test(trimmed) || !metaPrefixRegex?.test(trimmed);
  }

  if (fieldId === 'translation') {
    if (/^(?:thought|thought process|\.{2,}|\d+[.)]?)$/i.test(trimmed)) return false;
    if (trimmed.startsWith('*')) return false;
    if (/^(?:thought|thought process)$/i.test(trimmed)) return false;
    if (/^\d+\.\s/.test(trimmed)) return false;
    if (
      /\b(?:pick|choose|translate|explain|provide|answer|request|context|goal|task|user|confidence|constraint|checklist|execution|executing|preamble)\b/i.test(
        trimmed,
      )
    ) {
      return false;
    }
    if (/[<>]/.test(trimmed)) return false;
    if (trimmed.split(/\s+/).filter(Boolean).length > harness.translationMaxWords) return false;
    if (trimmed.includes('\n')) return false;
    return true;
  }

  return true;
}

export function sanitizeFieldContent(
  fieldId: string,
  value: string | undefined,
  options?: Partial<ContextTranslationHarnessSettings>,
): string {
  const harness = resolveContextTranslationHarnessSettings(options);
  if (!value) return '';
  if (!harness.sanitizeOutput) return normalizeWhitespace(value);

  const channelTail =
    harness.extractChannelTail
      ? extractChannelTail(value)
      : null;
  const nested =
    harness.extractNestedTags
      ? extractNestedFieldValue(fieldId, channelTail ?? value)
      : null;
  const normalized = normalizeWhitespace(
    (nested ?? channelTail ?? value)
      .replace(/^<translation>/i, '')
      .replace(/<\/translation>$/i, ''),
  );
  if (!normalized) return '';

  const metaPrefixRegex = buildMarkerRegex(harness.reasoningMarkers, { prefixOnly: true });
  const contaminationRegex = buildMarkerRegex([
    ...harness.contaminationMarkers,
    ...harness.reasoningMarkers,
  ]);

  if (fieldId === 'translation') {
    const looksSuspicious =
      (harness.stripReasoning && Boolean(metaPrefixRegex?.test(normalized))) ||
      Boolean(contaminationRegex?.test(normalized)) ||
      /Contextual Meaning|<translation>|<contextualMeaning>/i.test(
        normalized,
      ) ||
      normalized.includes('\n');

    if (!looksSuspicious) {
      return isLikelyFinalContentLine(fieldId, normalized, harness) ? normalized : '';
    }

    const candidate = normalized
      .split('\n')
      .map((line) => line.trim())
      .filter(Boolean)
      .reverse()
      .find((line) => isLikelyFinalContentLine(fieldId, line, harness));

    return candidate ? normalizeWhitespace(candidate) : '';
  }

  if (
    (!harness.stripReasoning || !metaPrefixRegex?.test(normalized)) &&
    !/[<][a-z][^>]*[>]/i.test(normalized)
  ) {
    return normalized;
  }

  const lines = normalized.split('\n');
  const startIndex = lines.findIndex((line) => isLikelyFinalContentLine(fieldId, line, harness));
  if (startIndex === -1) return '';

  const kept = lines.slice(startIndex).filter((line, index) => {
    if (fieldId === 'examples') return true;
    if (index === 0) return true;
    return !isLikelyReasoningLine(line, harness);
  });

  return normalizeWhitespace(kept.join('\n'));
}

export function sanitizeTranslationResult(
  parsed: TranslationResult,
  options?: Partial<ContextTranslationHarnessSettings>,
): TranslationResult {
  return Object.fromEntries(
    Object.entries(parsed).map(([fieldId, value]) => [
      fieldId,
      sanitizeFieldContent(fieldId, value, options),
    ]),
  );
}
