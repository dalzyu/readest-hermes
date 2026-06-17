import { describe, expect, test } from 'vitest';
import {
  SUPPORTED_DICTIONARY_IMPORT_FORMATS,
  lookupDictionaryEntries,
} from '@/services/learning/dictionaryService';

describe('dictionaryService', () => {
  test('advertises StarDict and DSL support', () => {
    expect(SUPPORTED_DICTIONARY_IMPORT_FORMATS).toContain('StarDict');
    expect(SUPPORTED_DICTIONARY_IMPORT_FORMATS).toContain('DSL');
  });

  test('returns no entries without installed dictionaries', async () => {
    await expect(lookupDictionaryEntries({ term: 'test', sourceLanguage: 'en' })).resolves.toEqual(
      [],
    );
  });
});
