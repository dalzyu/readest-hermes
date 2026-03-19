import type { TranslationRequest } from './types';
import { getTranslatorLanguageLabel } from '@/services/translatorLanguages';

function languageName(code: string): string {
  return getTranslatorLanguageLabel(code);
}

function isChineseSource(request: TranslationRequest): boolean {
  return request.sourceLanguage === 'zh' || /[\u3400-\u9fff]/u.test(request.selectedText);
}

export function buildTranslationPrompt(request: TranslationRequest): {
  systemPrompt: string;
  userPrompt: string;
} {
  const enabledFields = request.outputFields
    .filter((field) => field.enabled)
    .sort((a, b) => a.order - b.order);

  const targetLang = languageName(request.targetLanguage);
  const sourceLangHint = request.sourceLanguage
    ? ` The source language is ${request.sourceLanguage}.`
    : '';
  const orderedFieldIds = enabledFields.map((field) => field.id).join(', ');

  const fieldInstructions = enabledFields
    .map(
      (field) =>
        `- <${field.id}>: ${field.promptInstruction} Wrap your answer in <${field.id}>...</${field.id}> tags.`,
    )
    .join('\n');

  const chineseExamplesInstruction =
    isChineseSource(request) && enabledFields.some((field) => field.id === 'examples')
      ? `

If <examples> is requested, each numbered example must use this exact layout:
1. \u4e2d\u6587\u53e5\u5b50
English: ...

2. \u4e2d\u6587\u53e5\u5b50
English: ...

Do not include pinyin. The application will generate it separately.
`
      : '';

  const systemPrompt = `You are a literary translation assistant. Translate and explain text for a reader learning a foreign language.${sourceLangHint}

Always respond in ${targetLang}. For each request, provide the following fields, each wrapped in the specified XML tags:

${fieldInstructions}

Emit fields in this exact order: ${orderedFieldIds}.
Respond with ONLY the tagged fields. Do not add any preamble or extra commentary outside the tags.${chineseExamplesInstruction}`;

  const contextSections = [
    `<local_past_context>${request.popupContext.localPastContext}</local_past_context>`,
    request.popupContext.localFutureBuffer
      ? `<local_future_buffer>${request.popupContext.localFutureBuffer}</local_future_buffer>`
      : '',
    request.popupContext.sameBookChunks.length > 0
      ? `<same_book_memory>${request.popupContext.sameBookChunks.join('\n\n')}</same_book_memory>`
      : '',
    request.popupContext.priorVolumeChunks.length > 0
      ? `<prior_volume_memory>${request.popupContext.priorVolumeChunks.join('\n\n')}</prior_volume_memory>`
      : '',
  ]
    .filter(Boolean)
    .join('\n\n');

  const userPrompt = `<selected_text>${request.selectedText}</selected_text>

${contextSections}

Please translate and explain the selected text using the context provided.`;

  return { systemPrompt, userPrompt };
}
