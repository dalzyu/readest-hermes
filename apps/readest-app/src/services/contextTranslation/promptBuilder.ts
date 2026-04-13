import type { ContextLookupMode } from './modes';
import type { ContextDictionarySettings, TranslationRequest } from './types';
import { DEFAULT_CONTEXT_DICTIONARY_SETTINGS, getContextDictionaryOutputFields } from './defaults';
import { getTranslatorLanguageLabel } from '@/services/translatorLanguages';
import { getCJKLanguage } from '@/services/contextTranslation/utils';
import { getLanguagePairHints } from './languagePairHints';

function languageName(code: string): string {
  return getTranslatorLanguageLabel(code) || code;
}

/**
 * Returns true when the source text is Chinese.
 * Checks sourceLanguage first; falls back to page-context script analysis so that
 * pure-kanji text (which could be Japanese or Chinese) is correctly disambiguated
 * by looking for hiragana/katakana markers in the surrounding page.
 */
function isChineseSource(request: TranslationRequest): boolean {
  if (request.sourceLanguage === 'zh') return true;
  return (
    getCJKLanguage(request.selectedText, request.popupContext?.localPastContext ?? '') === 'chinese'
  );
}

function isChineseTarget(request: TranslationRequest): boolean {
  return request.targetLanguage === 'zh';
}

function buildContextSections(request: TranslationRequest): string {
  const sections = [
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
  ];

  if (request.popupContext.dictionaryEntries.length > 0) {
    sections.push(
      `<reference_dictionary>${request.popupContext.dictionaryEntries.join('\n')}</reference_dictionary>`,
    );
  }

  return sections.filter(Boolean).join('\n\n');
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
    ? ` The source language is ${languageName(request.sourceLanguage)}.`
    : '';
  const orderedFieldIds = enabledFields.map((field) => field.id).join(', ');
  const responseTemplate = enabledFields
    .map((field) => `<${field.id}>...</${field.id}>`)
    .join('\n');

  const fieldInstructions = enabledFields
    .map(
      (field) =>
        `- <${field.id}>: ${field.promptInstruction} Wrap your answer in <${field.id}>...</${field.id}> tags.`,
    )
    .join('\n');

  const examplesLayoutInstruction = enabledFields.some((field) => field.id === 'examples')
    ? isChineseSource(request)
      ? `

If <examples> is requested, each numbered example must use this exact layout:
1. 中文句子
English: ...

2. 中文句子
English: ...

Do not include pinyin. The application will generate it separately.
`
      : isChineseTarget(request)
        ? `

If <examples> is requested, each numbered example must use this exact layout:
1. English sentence
Chinese: 中文句子

2. English sentence
Chinese: 中文句子

Do not include pinyin. The application will generate it separately.
`
        : ''
    : '';

  const referenceDictionaryInstruction = `

If a <reference_dictionary> block is present, use it as an authoritative reference to ground your translation and explanation. Do not contradict it without strong contextual reason.`;

  const pairHints = request.sourceLanguage
    ? getLanguagePairHints(request.sourceLanguage, request.targetLanguage)
    : '';

  const systemPrompt = `You are a literary translation assistant. Translate and explain text for a reader learning a foreign language.${sourceLangHint}

Critical rules:
- The selected text is always written in the source language — never mistake it for an English word due to visual or phonetic similarity.
- Compound words, idioms, and set phrases must be translated as a single semantic unit; never decompose them character-by-character or word-by-word.
- When a word has multiple senses, choose the literary or emotional sense that fits a reader encountering the text in a book.
- For culturally unique terms with no exact equivalent, give the closest approximation and briefly note the cultural specificity.

You MUST respond entirely in ${targetLang} — every word in every field must be in ${targetLang}, not in English or any other language. For each request, provide the following fields, each wrapped in the specified XML tags:

${fieldInstructions}

Emit fields in this exact order: ${orderedFieldIds}.
Respond with ONLY the tagged fields. Do not add any preamble, reasoning, markdown, or extra commentary outside the tags.
Do not include internal reasoning inside any field. Never write phrases like "Thinking Process", "The user wants me", "Analyze the Request", plans, steps, or self-referential analysis in any tag.
Never leave a requested field empty. If context is limited, provide the shortest safe answer rather than an empty tag.
Use this exact output shape:
${responseTemplate}${examplesLayoutInstruction}${referenceDictionaryInstruction}${pairHints}`;

  const userPrompt = `<selected_text>${request.selectedText}</selected_text>

${buildContextSections(request)}

Please translate and explain the selected text using the context provided. Remember: your entire response must be in ${targetLang}.`;

  return { systemPrompt, userPrompt };
}

type LookupPromptRequest = TranslationRequest & {
  mode: ContextLookupMode;
  dictionarySettings?: ContextDictionarySettings;
};

function buildDictionaryPrompt(request: LookupPromptRequest): {
  systemPrompt: string;
  userPrompt: string;
} {
  const dictionarySettings = request.dictionarySettings ?? DEFAULT_CONTEXT_DICTIONARY_SETTINGS;
  const enabledFields = getContextDictionaryOutputFields(dictionarySettings)
    .filter((field) => field.enabled)
    .sort((a, b) => a.order - b.order);
  const sourceLanguage = request.sourceLanguage
    ? languageName(request.sourceLanguage)
    : 'the source language';
  const orderedFieldIds = enabledFields.map((field) => field.id).join(', ');

  const fieldInstructions = enabledFields
    .map(
      (field) =>
        `- <${field.id}>: ${field.promptInstruction} Wrap your answer in <${field.id}>...</${field.id}> tags.`,
    )
    .join('\n');

  const referenceDictionaryInstruction = `

If a <reference_dictionary> block is present, use it as an authoritative reference to ground your translation and explanation. Do not contradict it without strong contextual reason.`;

  // Chinese source examples layout guidance — tell LLM how to format Chinese examples in source language
  const sourceExamplesField = enabledFields.find((f) => f.id === 'sourceExamples');
  const examplesLayoutInstruction =
    sourceExamplesField && isChineseSource(request)
      ? `

If <sourceExamples> is requested, each numbered example must use this exact layout:
1. 中文句子

Do not include pinyin, English translation, or any other language — provide only the source-language example sentence. The application will generate phonetic annotations separately.
`
      : '';

  const pinyinProhibition = isChineseSource(request)
    ? '\n\nDo not include pinyin or any phonetic annotations in any field. The application will generate phonetic annotations separately.'
    : '';

  const systemPrompt = `You are a literary dictionary assistant.
Explain the selected text in simpler terms using only the source language.
The source language is ${sourceLanguage}. Do not translate the primary explanation into another language.

Critical rules:
- The selected text is always written in the source language — never mistake it for a word from another language due to visual similarity.
- Compound words, idioms, and set phrases must be explained as single semantic units; never decompose them part-by-part.
- When a word has multiple senses, choose the literary or emotional sense that fits a reader encountering the text in a book.

Provide the following fields:
${fieldInstructions}

Emit fields in this exact order: ${orderedFieldIds}.
You MUST respond entirely in ${sourceLanguage} — every word in every field must be in ${sourceLanguage}.
Respond with ONLY the tagged fields. Do not add any preamble or extra commentary outside the tags.${examplesLayoutInstruction}${pinyinProhibition}${referenceDictionaryInstruction}`;

  const userPrompt = `<selected_text>${request.selectedText}</selected_text>

${buildContextSections(request)}

Please explain the selected text in simpler source-language terms using the context provided. Remember: your entire response must be in ${sourceLanguage}.`;

  return { systemPrompt, userPrompt };
}

export function buildLookupPrompt(request: LookupPromptRequest): {
  systemPrompt: string;
  userPrompt: string;
} {
  const { systemPrompt, userPrompt } =
    request.mode === 'dictionary'
      ? buildDictionaryPrompt(request)
      : buildTranslationPrompt(request);

  const sentinelInstruction =
    '\n\nAfter all tagged fields, emit a final JSON summary wrapped in <lookup_json> and </lookup_json> tags containing all field values as a JSON object.';

  return {
    systemPrompt: systemPrompt + sentinelInstruction,
    userPrompt,
  };
}

// ---------------------------------------------------------------------------
// Per-field prompt builder (for fieldStrategy === 'multi')
// ---------------------------------------------------------------------------

/**
 * Generates a focused system+user prompt for a single output field.
 * The LLM response is expected to be raw text — no XML wrapping.
 */
export function buildPerFieldPrompt(
  field: { id: string; promptInstruction: string },
  request: TranslationRequest,
): { systemPrompt: string; userPrompt: string } {
  const targetLang = languageName(request.targetLanguage);
  const sourceLangHint = request.sourceLanguage
    ? ` The source language is ${languageName(request.sourceLanguage)}.`
    : '';

  const examplesLayout =
    field.id === 'examples'
      ? isChineseSource(request)
        ? '\nFormat each numbered example as:\n1. 中文句子\nEnglish: ...\nDo not include pinyin.'
        : isChineseTarget(request)
          ? '\nFormat each numbered example as:\n1. English sentence\nChinese: 中文句子\nDo not include pinyin.'
          : ''
      : '';

  const referenceDictNote =
    request.popupContext.dictionaryEntries.length > 0
      ? '\nIf a <reference_dictionary> block is present, use it as an authoritative reference.'
      : '';

  const pairHints = request.sourceLanguage
    ? getLanguagePairHints(request.sourceLanguage, request.targetLanguage)
    : '';

  const systemPrompt = `You are a literary translation assistant.${sourceLangHint}

Task: ${field.promptInstruction}

Respond entirely in ${targetLang}. Output ONLY the requested content — no preamble, no XML tags, no labels.
Do not reveal your reasoning. Never write "Thinking Process", "The user wants me", "Analyze the Request", steps, plans, or any self-referential analysis.${examplesLayout}${referenceDictNote}${pairHints}`;

  const userPrompt = `<selected_text>${request.selectedText}</selected_text>

${buildContextSections(request)}`;

  return { systemPrompt, userPrompt };
}
