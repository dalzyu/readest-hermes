import { describe, expect, test } from 'vitest';
import { ErrorCodes, isTranslationAvailable } from '@/services/learning/translatorService';
import type { Book } from '@/types/book';

describe('translatorService', () => {
  test('exports stable error codes', () => {
    expect(ErrorCodes.TRANSLATION_FAILED).toBe('TRANSLATION_FAILED');
  });

  test('does not offer full-page translation for PDF', () => {
    expect(isTranslationAvailable({ format: 'PDF', primaryLanguage: 'en' } as Book, 'fr')).toBe(
      false,
    );
  });
});
