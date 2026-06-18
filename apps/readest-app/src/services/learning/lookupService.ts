import { DEFAULT_AI_SETTINGS } from '@/services/ai/constants';
import type { AISettings } from '@/services/ai/types';
import { lookupDefinitions } from './dictionaryService';
import { getFrequencyBadge } from './frequencyService';
import { detectLookupLanguage } from './languagePolicy';
import type { DictionaryEntry, LookupRequest, LookupResult } from './types';
import { useSettingsStore } from '@/store/settingsStore';

export function detectLearningAIAvailability(aiSettings: AISettings): {
  enabled: boolean;
  reason?: string;
} {
  if (!aiSettings.enabled) return { enabled: false, reason: 'AI is disabled' };
  try {
    const profile = aiSettings.profiles?.find((item) => item.id === aiSettings.activeProfileId);
    if (!profile) return { enabled: false, reason: 'No active AI profile' };
    return { enabled: true };
  } catch {
    return { enabled: false, reason: 'AI lookup configuration is invalid' };
  }
}

function normalizeDictionaryEntry(entry: DictionaryEntry): DictionaryEntry {
  return {
    ...entry,
    term: entry.term ?? entry.headword,
    headword: entry.headword ?? entry.term ?? '',
  };
}

export async function lookup(request: LookupRequest): Promise<LookupResult> {
  const term = request.selectedText.trim();
  if (!term) throw new Error('Cannot look up empty selection');

  const detected = detectLookupLanguage(term);
  const sourceLanguage = detected.language ?? 'auto';
  const provenance: LookupResult['provenance'] = {};
  const installedDictionaries =
    useSettingsStore.getState().settings?.globalReadSettings?.dictionary?.dictionaries ?? [];
  const lookupSettings = useSettingsStore.getState().settings?.globalReadSettings?.lookup;

  if (request.signal?.aborted) throw new Error('Aborted');
  let translation: string | undefined;
  if (request.mode === 'translation') {
    const { translateWithUpstream } = await import('./translatorService');
    const translated = await translateWithUpstream({
      text: term,
      sourceLang: sourceLanguage,
      preferred: lookupSettings?.translatorProvider,
      targetLang: request.targetLanguage,
      useCache: true,
    });
    if (request.signal?.aborted) throw new Error('Aborted');
    translation = translated.text || undefined;
    if (translation) provenance.translation = 'translator';
  }
  let dictionaryEntries: DictionaryEntry[] = [];
  try {
    dictionaryEntries = (
      await lookupDefinitions(term, sourceLanguage, request.targetLanguage, installedDictionaries, {
        maxMatchTier: 4,
      })
    ).map(normalizeDictionaryEntry);
    if (dictionaryEntries.length > 0) provenance.dictionary = 'dictionary';
  } catch {
    dictionaryEntries = [];
  }
  if (request.signal?.aborted) throw new Error('Aborted');
  const frequencyBadge = await getFrequencyBadge(term, sourceLanguage);
  if (frequencyBadge) provenance.frequencyBadge = 'corpus';
  if (request.signal?.aborted) throw new Error('Aborted');

  return {
    term,
    mode: request.mode,
    sourceLanguage,
    targetLanguage: request.targetLanguage,
    translation,
    dictionaryEntries,
    examples: [],
    frequencyBadge: frequencyBadge ?? undefined,
    provenance,
  };
}

export { DEFAULT_AI_SETTINGS };
