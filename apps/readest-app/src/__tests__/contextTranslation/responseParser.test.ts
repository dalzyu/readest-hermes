import { describe, test, expect } from 'vitest';
import {
  parseStreamingTranslationResponse,
  parseTranslationResponse,
} from '@/services/contextTranslation/responseParser';
import type { TranslationOutputField } from '@/services/contextTranslation/types';

const fields: TranslationOutputField[] = [
  { id: 'translation', label: 'Translation', enabled: true, order: 0, promptInstruction: '' },
  {
    id: 'contextualMeaning',
    label: 'Contextual Meaning',
    enabled: true,
    order: 1,
    promptInstruction: '',
  },
  { id: 'examples', label: 'Examples', enabled: false, order: 2, promptInstruction: '' },
];

describe('parseTranslationResponse', () => {
  test('parses well-formed XML-tagged response', () => {
    const response = `<translation>
Hello world
</translation>

<contextualMeaning>
In this context, it means a greeting between friends.
</contextualMeaning>`;

    const result = parseTranslationResponse(response, fields);

    expect(result['translation']).toBe('Hello world');
    expect(result['contextualMeaning']).toBe(
      'In this context, it means a greeting between friends.',
    );
  });

  test('ignores disabled fields', () => {
    const response = `<translation>Hello</translation>
<examples>Example 1. Example 2.</examples>`;

    const result = parseTranslationResponse(response, fields);

    expect(result['translation']).toBe('Hello');
    expect(result['examples']).toBeUndefined();
  });

  test('falls back to full response as translation when no tags match', () => {
    const response = 'This is a plain text translation with no XML tags.';

    const result = parseTranslationResponse(response, fields);

    expect(result['translation']).toBe('This is a plain text translation with no XML tags.');
  });

  test('handles empty response by returning empty translation', () => {
    const result = parseTranslationResponse('', fields);

    expect(result['translation']).toBe('');
  });

  test('trims whitespace from parsed field values', () => {
    const response = `<translation>
  Trimmed value
</translation>`;

    const result = parseTranslationResponse(response, fields);

    expect(result['translation']).toBe('Trimmed value');
  });

  test('handles partial response with only some fields', () => {
    const response = `<translation>Partial</translation>`;

    const result = parseTranslationResponse(response, fields);

    expect(result['translation']).toBe('Partial');
    expect(result['contextualMeaning']).toBeUndefined();
  });

  test('handles multiline field values', () => {
    const response = `<translation>
Line one
Line two
Line three
</translation>`;

    const result = parseTranslationResponse(response, fields);

    expect(result['translation']).toBe('Line one\nLine two\nLine three');
  });
});

describe('parseStreamingTranslationResponse', () => {
  test('parses partial content for the active field while streaming', () => {
    const result = parseStreamingTranslationResponse('<translation>close fr', fields);

    expect(result.fields['translation']).toBe('close fr');
    expect(result.activeFieldId).toBe('translation');
  });

  test('keeps field order and accumulates later completed tags', () => {
    const result = parseStreamingTranslationResponse(
      '<translation>close friend</translation><contextualMeaning>a trusted companion',
      fields,
    );

    expect(result.fields['translation']).toBe('close friend');
    expect(result.fields['contextualMeaning']).toBe('a trusted companion');
    expect(result.activeFieldId).toBe('contextualMeaning');
  });
});
