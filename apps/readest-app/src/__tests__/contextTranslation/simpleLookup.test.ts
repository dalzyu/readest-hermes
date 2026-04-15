import { describe, expect, test, vi } from 'vitest';
import { runSimpleLookup } from '@/services/contextTranslation/simpleLookup';
import type { ContextLookupRequest } from '@/services/contextTranslation/contextLookupService';

const mockLookupDefinitions = vi
  .fn()
  .mockResolvedValue([{ headword: 'hello', definition: 'a greeting' }]);
vi.mock('@/services/contextTranslation/dictionaryService', () => ({
  lookupDefinitions: (...args: unknown[]) => mockLookupDefinitions(...args),
}));

const mockGoogleTranslate = vi.fn().mockResolvedValue(['Hola']);
const mockDeeplTranslate = vi.fn().mockResolvedValue([]);
vi.mock('@/services/translators', () => ({
  getTranslators: () => [
    { name: 'google', translate: (...args: unknown[]) => mockGoogleTranslate(...args) },
    { name: 'deepl', translate: (...args: unknown[]) => mockDeeplTranslate(...args) },
  ],
}));

const baseRequest: ContextLookupRequest = {
  mode: 'translation',
  selectedText: 'hello',
  popupContext: {
    localPastContext: '',
    localFutureBuffer: '',
    sameBookChunks: [],
    priorVolumeChunks: [],
    dictionaryEntries: [],
    retrievalStatus: 'local-only',
    retrievalHints: {
      currentVolumeIndexed: false,
      missingLocalIndex: false,
      missingPriorVolumes: [],
      missingSeriesAssignment: false,
    },
  },
  targetLanguage: 'es',
  sourceLanguage: 'en',
  outputFields: [],
};

describe('runSimpleLookup', () => {
  test('dictionary source returns formatted headword:definition string', async () => {
    const result = await runSimpleLookup(baseRequest, 'dictionary');
    expect(result.fields['translation']).toBe('hello: a greeting');
    expect(result.validationDecision).toBe('accept');
    expect(result.detectedLanguage.language).toBe('en');
  });

  test('external service translator is found by name and result used', async () => {
    const result = await runSimpleLookup(baseRequest, 'google');
    expect(mockGoogleTranslate).toHaveBeenCalledWith(['hello'], 'en', 'es');
    expect(result.fields['translation']).toBe('Hola');
  });

  test('external service returns empty string when translator yields empty array', async () => {
    const result = await runSimpleLookup(baseRequest, 'deepl');
    expect(result.fields['translation']).toBe('');
  });

  test('throws when translator name not found in registry', async () => {
    await expect(runSimpleLookup(baseRequest, 'yandex')).rejects.toThrow(
      'yandex translator not found',
    );
  });

  test('sourceLanguage defaults to en when absent from request', async () => {
    const reqNoLang: ContextLookupRequest = { ...baseRequest, sourceLanguage: undefined };
    const result = await runSimpleLookup(reqNoLang, 'dictionary');
    expect(result.detectedLanguage.language).toBe('en');
  });

  test('lookupDefinitions is called without disabledBundledDicts', async () => {
    await runSimpleLookup(baseRequest, 'dictionary');
    expect(mockLookupDefinitions).toHaveBeenCalledWith('hello', 'en', 'es');
  });
});
