import { useCallback, useEffect, useRef, useState } from 'react';
import { lookup } from '@/services/learning/lookupService';
import { saveLookupHistoryEntry } from '@/services/learning/lookupHistoryService';
import { saveVocabularyEntry } from '@/services/learning/vocabularyService';
import type { LookupMode, LookupResult } from '@/services/learning/types';
import { useSettingsStore } from '@/store/settingsStore';
import { eventDispatcher } from '@/utils/event';

export interface UseLearningLookupInput {
  bookKey: string;
  bookHash: string;
  selectedText: string;
  mode: LookupMode;
}

export interface UseLearningLookupResult {
  result: LookupResult | null;
  loading: boolean;
  error: string | null;
  saveToVocabulary: () => Promise<void>;
  retry: () => void;
}

export function useLearningLookup(input: UseLearningLookupInput): UseLearningLookupResult {
  const targetLanguage = useSettingsStore(
    (state) =>
      state.settings.globalReadSettings?.lookup?.targetLanguage ??
      state.settings.globalReadSettings?.translateTargetLang ??
      'en',
  );
  const [result, setResult] = useState<LookupResult | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [nonce, setNonce] = useState(0);
  const abortRef = useRef<AbortController | null>(null);

  useEffect(() => {
    const selectedText = input.selectedText.trim();
    if (!selectedText || !input.bookHash) return;
    abortRef.current?.abort();
    const controller = new AbortController();
    abortRef.current = controller;
    setLoading(true);
    setError(null);
    lookup({
      bookKey: input.bookKey,
      bookHash: input.bookHash,
      selectedText,
      mode: input.mode,
      targetLanguage,
      signal: controller.signal,
    })
      .then((next) => {
        if (controller.signal.aborted) return;
        setResult(next);
        saveLookupHistoryEntry({
          bookHash: input.bookHash,
          term: next.term,
          context: selectedText,
          result: {
            translation: next.translation ?? '',
            contextualMeaning: next.dictionaryEntries[0]?.definition ?? '',
          },
          mode: next.mode,
        });
        eventDispatcher.dispatch('lookup-history-updated', { bookHash: input.bookHash });
      })
      .catch((reason) => {
        if (controller.signal.aborted) return;
        setError(reason instanceof Error ? reason.message : String(reason));
      })
      .finally(() => {
        if (!controller.signal.aborted) setLoading(false);
      });

    return () => controller.abort();
  }, [input.bookKey, input.bookHash, input.mode, input.selectedText, targetLanguage, nonce]);

  const saveToVocabulary = useCallback(async () => {
    if (!result) return;
    await saveVocabularyEntry({
      bookHash: input.bookHash,
      term: result.term,
      context: input.selectedText,
      result: {
        translation: result.translation ?? '',
        contextualMeaning: result.dictionaryEntries[0]?.definition ?? '',
      },
      mode: result.mode,
      sourceLanguage: result.sourceLanguage,
      targetLanguage: result.targetLanguage,
      examples: result.examples.map((example) => ({
        text: example.text ?? example.sourceText ?? '',
        translation: example.translation ?? example.targetText,
        source: example.source,
        exampleId: example.exampleId,
      })),
    });
    eventDispatcher.dispatch('vocabulary-updated', { bookHash: input.bookHash });
  }, [input.bookHash, input.selectedText, result]);

  return {
    result,
    loading,
    error,
    saveToVocabulary,
    retry: () => setNonce((value) => value + 1),
  };
}
