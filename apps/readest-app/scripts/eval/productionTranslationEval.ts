import { performance } from 'node:perf_hooks';
import {
  DEFAULT_CONTEXT_TRANSLATION_SETTINGS,
} from '../../src/services/contextTranslation/defaults';
import {
  buildPerFieldPrompt,
  buildTranslationPrompt,
} from '../../src/services/contextTranslation/promptBuilder';
import {
  parseTranslationResponse,
} from '../../src/services/contextTranslation/responseParser';
import {
  sanitizeFieldContent,
  sanitizeTranslationResult,
} from '../../src/services/contextTranslation/translationSanitizer';
import type {
  PromptEvalReport,
  PromptTestFixture,
  PromptTestResult,
} from '../../src/services/contextTranslation/promptTestHarness';

export type ProductionPromptTestResult = PromptTestResult & {
  structuralFlags: {
    parsedMeta: boolean;
    missingPrimary: boolean;
    rawContaminated: boolean;
  };
};

const PRODUCTION_OUTPUT_FIELDS = DEFAULT_CONTEXT_TRANSLATION_SETTINGS.outputFields.filter(
  (field) => field.id !== 'grammarHint',
);

export function responseLooksContaminated(response: string): boolean {
  return /Thinking Process|Thought Process|The user wants me|Analyze the Request|Here'?s a thinking process|Here'?s a plan|Confidence Score|<channel\|>/i.test(
    response,
  );
}

export function parsedFieldsLookContaminated(fields: Record<string, string>): boolean {
  return Object.values(fields).some((value) =>
    responseLooksContaminated(value) ||
    /^\s*\*/m.test(value) ||
    /Selected word:|Source Text:|Contextual Setup:|Narrative:|Original field request/i.test(value),
  );
}

function buildTranslationRepairPrompt(
  originalSystemPrompt: string,
  originalUserPrompt: string,
  fieldIds: string[],
): { systemPrompt: string; userPrompt: string } {
  const template = fieldIds.map((id) => `<${id}>...</${id}>`).join('\n');
  return {
    systemPrompt: `${originalSystemPrompt}

The previous answer did not follow the required XML shape.
Rewrite the answer now with ONLY these tags and in this exact order:
${template}
Do not include reasoning, markdown, or any extra text.
Do not write phrases like "Thinking Process", "The user wants me", "Analyze the Request", steps, plans, or self-referential analysis inside any tag.`,
    userPrompt:
      `Retry the same request exactly and return only valid XML tags in the required order.\n\nOriginal request:\n${originalUserPrompt}`,
  };
}

function buildPerFieldRepairPrompt(
  fieldId: string,
  targetLanguage: string,
  originalSystemPrompt: string,
  originalUserPrompt: string,
): { systemPrompt: string; userPrompt: string } {
  return {
    systemPrompt: `You are a literary translation assistant.

Return ONLY the final ${fieldId} content in ${targetLanguage}.
Do not reveal your reasoning. Do not write "Thinking Process", "The user wants me", "Analyze the Request", confidence scores, plans, steps, XML tags, labels, markdown, or extra commentary.
Original field request:
${originalSystemPrompt}`,
    userPrompt: `Retry the same ${fieldId} request and output only the final content.

Original request:
${originalUserPrompt}`,
  };
}

function buildRequest(fixture: PromptTestFixture) {
  return {
    selectedText: fixture.sourceText,
    popupContext: {
      localPastContext: fixture.bookContext ?? '',
      localFutureBuffer: '',
      sameBookChunks: [],
      priorVolumeChunks: [],
      dictionaryEntries: [],
      retrievalStatus: 'local-only' as const,
      retrievalHints: {
        currentVolumeIndexed: false,
        missingLocalIndex: false,
        missingPriorVolumes: [],
        missingSeriesAssignment: false,
      },
    },
    sourceLanguage: fixture.sourceLanguage,
    targetLanguage: fixture.targetLanguage,
    outputFields: PRODUCTION_OUTPUT_FIELDS,
  };
}

function hasUsablePrimaryField(parsed: Record<string, string>): boolean {
  return Boolean(parsed['translation']?.trim());
}

function completionRatio(parsed: Record<string, string>): number {
  const enabledCount = PRODUCTION_OUTPUT_FIELDS.filter((field) => field.enabled).length;
  if (enabledCount === 0) return 1;
  const completed = PRODUCTION_OUTPUT_FIELDS.filter(
    (field) => field.enabled && Boolean(parsed[field.id]?.trim()),
  ).length;
  return completed / enabledCount;
}

export async function runProductionPromptEval(
  fixtures: PromptTestFixture[],
  callModel: (
    systemPrompt: string,
    userPrompt: string,
    label?: string,
  ) => Promise<{
    text: string;
    promptTokens?: number;
    completionTokens?: number;
  }>,
  meta: { model: string; provider: string },
): Promise<PromptEvalReport & { results: ProductionPromptTestResult[] }> {
  const runId = `production-eval-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
  const startedAt = Date.now();
  const results: ProductionPromptTestResult[] = [];

  for (const fixture of fixtures) {
    const request = buildRequest(fixture);
    const { systemPrompt, userPrompt } = buildTranslationPrompt(request);
    const t0 = performance.now();

    try {
      let attemptCount = 1;
      const rawSegments: string[] = [];

      const initial = await callModel(systemPrompt, userPrompt, 'initial');
      rawSegments.push(initial.text);
      let response = initial;
      let parsedFields = sanitizeTranslationResult(
        parseTranslationResponse(initial.text, request.outputFields),
      );
      let contaminated = responseLooksContaminated(initial.text);

      if (contaminated || !hasUsablePrimaryField(parsedFields) || completionRatio(parsedFields) < 0.5) {
        attemptCount += 1;
        const repair = buildTranslationRepairPrompt(
          systemPrompt,
          userPrompt,
          request.outputFields
            .filter((field) => field.enabled)
            .sort((a, b) => a.order - b.order)
            .map((field) => field.id),
        );
        response = await callModel(repair.systemPrompt, repair.userPrompt, 'repair');
        rawSegments.push(response.text);
        parsedFields = sanitizeTranslationResult(
          parseTranslationResponse(response.text, request.outputFields),
        );
        contaminated = responseLooksContaminated(response.text);
      }

      if (contaminated || !hasUsablePrimaryField(parsedFields)) {
        const stitched: Record<string, string> = {};
        for (const field of request.outputFields.filter((item) => item.enabled)) {
          const perField = buildPerFieldPrompt(field, request);
          let fieldResponse = await callModel(perField.systemPrompt, perField.userPrompt, `field:${field.id}`);
          rawSegments.push(fieldResponse.text);
          attemptCount += 1;

          let sanitizedFieldValue = sanitizeFieldContent(field.id, fieldResponse.text);

          if (responseLooksContaminated(fieldResponse.text) || !sanitizedFieldValue.trim()) {
            const repair = buildPerFieldRepairPrompt(
              field.id,
              request.targetLanguage,
              perField.systemPrompt,
              perField.userPrompt,
            );
            fieldResponse = await callModel(
              repair.systemPrompt,
              repair.userPrompt,
              `field-repair:${field.id}`,
            );
            rawSegments.push(fieldResponse.text);
            attemptCount += 1;
            sanitizedFieldValue = sanitizeFieldContent(field.id, fieldResponse.text);
          }

          stitched[field.id] = sanitizedFieldValue;
        }

        parsedFields = stitched;
      }

      const latencyMs = Math.round(performance.now() - t0);
      const rawResponse = rawSegments.join('\n---ATTEMPT---\n');
      results.push({
        fixtureId: fixture.id,
        model: meta.model,
        provider: meta.provider,
        fields: parsedFields,
        latencyMs,
        promptTokens: response.promptTokens,
        completionTokens: response.completionTokens,
        rawResponse,
        timestamp: Date.now(),
        attemptCount,
        structuralFlags: {
          parsedMeta: parsedFieldsLookContaminated(parsedFields),
          missingPrimary: !hasUsablePrimaryField(parsedFields),
          rawContaminated: rawSegments.some((segment) => responseLooksContaminated(segment)),
        },
      });
    } catch (err) {
      results.push({
        fixtureId: fixture.id,
        model: meta.model,
        provider: meta.provider,
        fields: {},
        latencyMs: Math.round(performance.now() - t0),
        rawResponse: `ERROR: ${err instanceof Error ? err.message : String(err)}`,
        timestamp: Date.now(),
        structuralFlags: {
          parsedMeta: false,
          missingPrimary: true,
          rawContaminated: false,
        },
      });
    }
  }

  const completedAt = Date.now();
  const succeeded = results.filter((result) => Object.keys(result.fields).length > 0).length;
  const averageLatencyMs =
    results.length > 0
      ? Math.round(results.reduce((sum, result) => sum + result.latencyMs, 0) / results.length)
      : 0;

  return {
    runId,
    startedAt,
    completedAt,
    model: meta.model,
    provider: meta.provider,
    results,
    summary: {
      totalFixtures: fixtures.length,
      succeeded,
      failed: fixtures.length - succeeded,
      averageLatencyMs,
    },
  };
}
