import { describe, expect, test, vi } from 'vitest';
import { runSimpleLookup } from '@/services/contextTranslation/simpleLookup';
import type { ContextLookupRequest } from '@/services/contextTranslation/contextLookupService';

const mockLookupDefinitions = vi
  .fn()
  .mockResolvedValue([{ headword: 'hello', definition: 'a greeting' }]);
vi.mock('@/services/contextTranslation/dictionaryService', () => ({
  lookupDefinitions: (...args: unknown[]) => mockLookupDefinitions(...args),
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
