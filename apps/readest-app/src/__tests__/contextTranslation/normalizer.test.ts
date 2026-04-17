import { describe, expect, test } from 'vitest';
import { normalizeLookupResponse } from '@/services/contextTranslation/normalizer';

describe('normalizeLookupResponse — sentinel JSON path', () => {
  test('normalizes sentinel-delimited JSON-in-text into the translation model', () => {
    const result = normalizeLookupResponse(
      '<lookup_json>{"translation":"翻译"}</lookup_json>',
      'translation',
    );
    expect(result['translation']).toBe('翻译');
  });

  test('extracts all JSON fields when multiple fields are present', () => {
    const result = normalizeLookupResponse(
      '<lookup_json>{"translation":"bonjour","contextualMeaning":"hello"}</lookup_json>',
      'translation',
    );
    expect(result['translation']).toBe('bonjour');
    expect(result['contextualMeaning']).toBe('hello');
  });

  test('prefers lookup_json over preceding XML tags when both are present', () => {
    const result = normalizeLookupResponse(
      '<translation>wrong</translation><lookup_json>{"translation":"right"}</lookup_json>',
      'translation',
    );
    expect(result['translation']).toBe('right');
  });
});

describe('normalizeLookupResponse — plain JSON fallback', () => {
  test('parses a plain JSON object without sentinel tags', () => {
    const result = normalizeLookupResponse(
      '{"translation":"close friend","contextualMeaning":"a trusted companion"}',
      'translation',
    );
    expect(result['translation']).toBe('close friend');
    expect(result['contextualMeaning']).toBe('a trusted companion');
  });

  test('parses fenced JSON blocks', () => {
    const result = normalizeLookupResponse(
      '```json\n{"translation":"知己","sourceExamples":["知己难逢", "得一知己足矣"]}\n```',
      'dictionary',
    );
    expect(result['translation']).toBe('知己');
    expect(result['sourceExamples']).toContain('知己难逢');
    expect(result['sourceExamples']).toContain('得一知己足矣');
  });

  test('extracts JSON object wrapped in prose', () => {
    const result = normalizeLookupResponse(
      'Here is the result: {"translation":"ally","contextualMeaning":"trusted helper"} Thanks.',
      'translation',
    );
    expect(result['translation']).toBe('ally');
    expect(result['contextualMeaning']).toBe('trusted helper');
  });
});

describe('normalizeLookupResponse — XML tag fallback', () => {
  test('falls back from tagged text into the same model', () => {
    const result = normalizeLookupResponse('<translation>bonjour</translation>', 'translation');
    expect(result['translation']).toBe('bonjour');
  });

  test('parses multiple XML tags as fallback', () => {
    const result = normalizeLookupResponse(
      '<translation>hello</translation><contextualMeaning>a greeting</contextualMeaning>',
      'translation',
    );
    expect(result['translation']).toBe('hello');
    expect(result['contextualMeaning']).toBe('a greeting');
  });

  test('falls back to raw text as translation when no tags are found', () => {
    const result = normalizeLookupResponse('just plain text', 'translation');
    expect(result['translation']).toBe('just plain text');
  });
});
