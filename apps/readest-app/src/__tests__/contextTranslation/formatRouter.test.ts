import { describe, expect, test } from 'vitest';

import {
  detectFormat,
  parseDictionary,
  SUPPORTED_DICTIONARY_IMPORT_EXTENSIONS,
  SUPPORTED_DICTIONARY_IMPORT_FORMATS,
} from '@/services/contextTranslation/parsers/formatRouter';

const encoder = new TextEncoder();

describe('formatRouter', () => {
  test('detects the expanded set of import formats', () => {
    expect(detectFormat('sample.csv')).toBe('csv');
    expect(detectFormat('sample.tsv')).toBe('tsv');
    expect(detectFormat('sample.txt')).toBe('txt');
    expect(detectFormat('sample.json')).toBe('json');
    expect(detectFormat('sample.jsonl')).toBe('jsonl');
    expect(SUPPORTED_DICTIONARY_IMPORT_EXTENSIONS).toContain('.jsonl');
    expect(SUPPORTED_DICTIONARY_IMPORT_FORMATS).toContain('JSON');
  });

  test('parses CSV dictionaries with headers', async () => {
    const { entries, name } = await parseDictionary(
      'glossary.csv',
      encoder.encode('headword,definition\nhello,greeting\nworld,planet'),
    );

    expect(name).toBe('glossary');
    expect(entries).toEqual([
      { headword: 'hello', definition: 'greeting' },
      { headword: 'world', definition: 'planet' },
    ]);
  });

  test('parses JSON dictionaries from arrays and key/value maps', async () => {
    const { entries } = await parseDictionary(
      'glossary.json',
      encoder.encode(
        JSON.stringify([
          { headword: 'hello', definition: 'greeting' },
          ['world', 'planet'],
          { term: 'sun', meaning: 'star' },
        ]),
      ),
    );

    expect(entries).toEqual([
      { headword: 'hello', definition: 'greeting' },
      { headword: 'world', definition: 'planet' },
      { headword: 'sun', definition: 'star' },
    ]);
  });

  test('parses plain text dictionaries with separators', async () => {
    const { entries } = await parseDictionary(
      'glossary.txt',
      encoder.encode('hello - greeting\nworld: planet\n'),
    );

    expect(entries).toEqual([
      { headword: 'hello', definition: 'greeting' },
      { headword: 'world', definition: 'planet' },
    ]);
  });
});
