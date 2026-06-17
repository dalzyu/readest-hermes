import { getProviderForTask } from '@/services/ai/providers';
import type { AISettings, AITaskType } from '@/services/ai/types';

import {
  resolveContextDictionaryFieldSources,
  resolveContextTranslationFieldSources,
} from './defaults';
import type { ContextDictionarySettings, ContextTranslationSettings, FieldSource } from './types';
import type { ContextLookupMode } from './modes';

export interface SourceAvailability {
  chat: boolean;
  embedding: boolean;
}

export type FieldSourceMap = Partial<Record<string, FieldSource>>;

function canResolveTask(aiSettings: AISettings, task: AITaskType): boolean {
  try {
    getProviderForTask(aiSettings, task);
    return true;
  } catch {
    return false;
  }
}

export function detectAIAvailability(aiSettings: AISettings): SourceAvailability {
  if (!aiSettings.enabled) {
    return { chat: false, embedding: false };
  }

  const chat =
    canResolveTask(aiSettings, 'translation') ||
    canResolveTask(aiSettings, 'dictionary') ||
    canResolveTask(aiSettings, 'chat');

  return {
    chat,
    embedding: canResolveTask(aiSettings, 'embedding'),
  };
}

function getTranslationFieldSources(
  settings: ContextTranslationSettings,
): ReturnType<typeof resolveContextTranslationFieldSources> {
  return resolveContextTranslationFieldSources(settings);
}

function resolveTranslationSources(
  settings: ContextTranslationSettings,
  availability: SourceAvailability,
): FieldSourceMap {
  const configuredSources = getTranslationFieldSources(settings);
  const configuredTranslation = configuredSources.translation;
  const translationSource =
    configuredTranslation === 'ai'
      ? availability.chat
        ? 'ai'
        : 'translator'
      : configuredTranslation;

  const contextualMeaningSource =
    (configuredSources.contextualMeaning ??
      (configuredTranslation === 'dictionary' ? 'dictionary' : 'ai')) === 'ai'
      ? availability.chat
        ? 'ai'
        : 'dictionary'
      : 'dictionary';

  const examplesSource =
    (configuredSources.examples ?? 'ai') === 'ai'
      ? availability.chat
        ? 'ai'
        : 'corpus'
      : 'corpus';

  const fieldSources: FieldSourceMap = {
    translation: translationSource,
    contextualMeaning: contextualMeaningSource,
    examples: examplesSource,
  };

  if ((configuredSources.grammarHint ?? 'ai') === 'ai' && availability.chat) {
    fieldSources['grammarHint'] = 'ai';
  }

  return fieldSources;
}

function resolveDictionarySources(
  dictionarySettings: ContextDictionarySettings,
  availability: SourceAvailability,
): FieldSourceMap {
  const defaults = resolveContextDictionaryFieldSources(dictionarySettings);

  const simpleDefinitionSetting = defaults.simpleDefinition;
  const contextualMeaningSetting = defaults.contextualMeaning;
  const sourceExamplesSetting = defaults.sourceExamples as 'ai' | 'dictionary' | 'corpus';

  const fieldSources: FieldSourceMap = {
    simpleDefinition:
      simpleDefinitionSetting === 'ai' ? (availability.chat ? 'ai' : 'dictionary') : 'dictionary',
    contextualMeaning:
      contextualMeaningSetting === 'ai' ? (availability.chat ? 'ai' : 'dictionary') : 'dictionary',
  };

  if (dictionarySettings.sourceExamples) {
    if (sourceExamplesSetting === 'ai') {
      fieldSources['sourceExamples'] = availability.chat ? 'ai' : 'corpus';
    } else if (sourceExamplesSetting === 'dictionary') {
      fieldSources['sourceExamples'] = 'dictionary';
    } else {
      fieldSources['sourceExamples'] = 'corpus';
    }
  }

  return fieldSources;
}

export function resolveFieldSources(
  mode: ContextLookupMode,
  settings: ContextTranslationSettings,
  dictionarySettings: ContextDictionarySettings,
  availability: SourceAvailability,
): FieldSourceMap {
  if (mode === 'dictionary') {
    return resolveDictionarySources(dictionarySettings, availability);
  }

  return resolveTranslationSources(settings, availability);
}
