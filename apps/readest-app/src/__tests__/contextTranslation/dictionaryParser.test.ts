import { describe, test, expect } from 'vitest';
import { parseIfo, parseStarDict } from '@/services/contextTranslation/dictionaryParser';

describe('parseIfo', () => {
  test('extracts bookname and wordcount', () => {
    const buf = new TextEncoder().encode(
      "StarDict's dict w/ ex.\nversion=2.4.8\nbookname=testdict\nwordcount=123\nsametypesequence=m\n",
    );
    const result = parseIfo(buf);
    expect(result.name).toBe('testdict');
    expect(result.wordcount).toBe(123);
  });

  test('throws if bookname missing', () => {
    const buf = new TextEncoder().encode('version=2.4.8\nwordcount=10\n');
    expect(() => parseIfo(buf)).toThrow();
  });
});

describe('parseStarDict', () => {
  test('parses idx entries and slices dict buffer', () => {
    // Build a minimal .idx: headword "hello\0" + offset=0 + size=5
    const idx = new Uint8Array([104, 101, 108, 108, 111, 0, 0, 0, 0, 0, 0, 0, 0, 5]);
    // dict: "world"
    const dict = new TextEncoder().encode('world');
    const result = parseStarDict({ ifo: new Uint8Array(), idx, dict });
    expect(result).toHaveLength(1);
    expect(result[0]!.headword).toBe('hello');
    expect(result[0]!.definition).toBe('world');
  });

  test('strips HTML from definition when sametypesequence starts with h', () => {
    const ifo = new TextEncoder().encode('bookname=x\nwordcount=1\nsametypesequence=h\n');
    const idx = new Uint8Array([120, 0, 0, 0, 0, 0, 0, 0, 0, 11]);
    const dict = new TextEncoder().encode('<b>bold</b>');
    const result = parseStarDict({ ifo, idx, dict });
    expect(result[0]!.definition).toBe('bold');
  });

  test('throws if no recognized type in sametypesequence', () => {
    const ifo = new TextEncoder().encode('bookname=x\nwordcount=1\nsametypesequence=x\n');
    const idx = new Uint8Array([120, 0, 0, 0, 0, 0, 0, 0, 0, 5]);
    const dict = new TextEncoder().encode('hello');
    expect(() => parseStarDict({ ifo, idx, dict })).toThrow();
  });
});
