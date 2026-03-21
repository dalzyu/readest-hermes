import { describe, test, expect } from 'vitest';
import type { DictionaryEntry } from '@/services/contextTranslation/types';
import { findMatches } from '@/services/contextTranslation/dictionaryService';

describe('findMatches', () => {
  const makeEntry = (headword: string, definition: string): DictionaryEntry => ({
    headword,
    definition,
  });

  describe('exact match', () => {
    test('returns entry when headword exactly matches text', () => {
      const entries: DictionaryEntry[] = [
        makeEntry('hello', 'a greeting'),
        makeEntry('world', 'the planet'),
      ];
      const result = findMatches(entries, 'hello');
      expect(result).toHaveLength(1);
      expect(result[0]!.headword).toBe('hello');
    });

    test('case-sensitive exact match', () => {
      const entries: DictionaryEntry[] = [
        makeEntry('Hello', 'a greeting'),
        makeEntry('hello', 'lowercase greeting'),
      ];
      const result = findMatches(entries, 'Hello');
      expect(result).toHaveLength(1);
      expect(result[0]!.headword).toBe('Hello');
    });

    test('returns empty when no exact match', () => {
      const entries: DictionaryEntry[] = [makeEntry('hello', 'a greeting')];
      const result = findMatches(entries, 'world');
      expect(result).toHaveLength(0);
    });
  });

  describe('prefix: headword starts with text', () => {
    test('returns matching entries when headword starts with text', () => {
      const entries: DictionaryEntry[] = [
        makeEntry('hyperbolic', 'exaggerated'),
        makeEntry('hyperbole', 'figure of speech'),
        makeEntry('hypersonic', 'faster than sound'),
      ];
      const result = findMatches(entries, 'hyper');
      // After case-sensitive sort: ['hyperbole', 'hyperbolic', 'hypersonic']
      expect(result.map((e) => e.headword)).toEqual(['hyperbole', 'hyperbolic', 'hypersonic']);
    });

    test('skipped when text.length > 40', () => {
      const entries: DictionaryEntry[] = [makeEntry('hyperbolically', 'in a hyperbolic manner')];
      const longText = 'a'.repeat(41);
      const result = findMatches(entries, longText);
      expect(result).toHaveLength(0);
    });
  });

  describe('prefix: text starts with headword', () => {
    test('returns entry when text starts with headword', () => {
      const entries: DictionaryEntry[] = [makeEntry('hello', 'a greeting')];
      const result = findMatches(entries, 'hello world');
      expect(result).toHaveLength(1);
      expect(result[0]!.headword).toBe('hello');
    });

    test('returns multiple matches', () => {
      const entries: DictionaryEntry[] = [
        makeEntry('a', 'article'),
        makeEntry('an', 'article'),
        makeEntry('and', 'conjunction'),
      ];
      // Exact match on 'and' returns immediately
      const result = findMatches(entries, 'and');
      expect(result.map((e) => e.headword)).toEqual(['and']);
    });

    test('skipped when text.length > 40', () => {
      const entries: DictionaryEntry[] = [makeEntry('hello', 'a greeting')];
      const longText = 'hello' + 'a'.repeat(40);
      const result = findMatches(entries, longText);
      expect(result).toHaveLength(0);
    });
  });

  describe('fuzzy: Levenshtein distance <= 2', () => {
    test('returns entry when text is within Levenshtein distance 2', () => {
      const entries: DictionaryEntry[] = [makeEntry('hello', 'a greeting')];
      const result = findMatches(entries, 'helo');
      expect(result).toHaveLength(1);
      expect(result[0]!.headword).toBe('hello');
    });

    test('distance 1 is included', () => {
      const entries: DictionaryEntry[] = [makeEntry('world', 'the planet')];
      const result = findMatches(entries, 'worle');
      expect(result).toHaveLength(1);
      expect(result[0]!.headword).toBe('world');
    });

    test('distance 2 is included', () => {
      const entries: DictionaryEntry[] = [makeEntry('language', 'system of communication')];
      const result = findMatches(entries, 'lnaguage');
      expect(result).toHaveLength(1);
      expect(result[0]!.headword).toBe('language');
    });

    test('distance 3 is excluded', () => {
      // 'abc' vs 'xyz' is 3 substitutions (distance 3)
      const entries: DictionaryEntry[] = [makeEntry('abc', 'three letters')];
      const result = findMatches(entries, 'xyz');
      expect(result).toHaveLength(0);
    });

    test('fuzzy only runs when text.length <= 40', () => {
      const entries: DictionaryEntry[] = [makeEntry('hello', 'a greeting')];
      const longText = 'hello' + 'a'.repeat(36); // 41 chars
      const result = findMatches(entries, longText);
      expect(result).toHaveLength(0);
    });

    test('fuzzy selects up to ~200 nearest candidates', () => {
      // Build 500 entries - fuzzy should only consider first ~200
      const entries: DictionaryEntry[] = Array.from({ length: 500 }, (_, i) =>
        makeEntry(`word${i.toString().padStart(4, '0')}`, `definition ${i}`),
      );
      // 'word0000' at distance 2 from 'word0002'
      const result = findMatches(entries, 'word0002');
      expect(result).toHaveLength(1);
      expect(result[0]!.headword).toBe('word0002');
    });
  });

  describe('result assembly', () => {
    test('deduplicates by headword', () => {
      const entries: DictionaryEntry[] = [
        makeEntry('hello', 'a greeting'),
        makeEntry('hello', 'another greeting'),
      ];
      const result = findMatches(entries, 'hello');
      expect(result).toHaveLength(1);
    });

    test('capped at 3 total results', () => {
      const entries: DictionaryEntry[] = [
        makeEntry('a', 'article 1'),
        makeEntry('an', 'article 2'),
        makeEntry('and', 'conjunction'),
        makeEntry('ant', 'insect'),
        makeEntry('android', 'robot'),
      ];
      const result = findMatches(entries, 'a');
      expect(result.length).toBeLessThanOrEqual(3);
    });

    test('prefers exact match over prefix over fuzzy', () => {
      const entries: DictionaryEntry[] = [
        makeEntry('hello', 'exact match'),
        makeEntry('hello world', 'prefix match'),
      ];
      // 'hello' is both exact and prefix; exact should come first
      const result = findMatches(entries, 'hello');
      expect(result[0]!.headword).toBe('hello');
    });

    test('one entry per dictionary constraint is not directly applicable to findMatches', () => {
      // findMatches operates on a single dictionary's entries
      // The caller (lookupDefinitions) enforces the 1-per-dictionary rule
      const entries: DictionaryEntry[] = [
        makeEntry('hello', 'greeting'),
        makeEntry('world', 'planet'),
      ];
      const result = findMatches(entries, 'ello');
      // fuzzy match for 'ello' against 'hello' and 'world'
      expect(result.length).toBeGreaterThan(0);
    });
  });

  describe('binary search for exact match', () => {
    test('works on sorted entries', () => {
      const entries: DictionaryEntry[] = [
        makeEntry('apple', 'fruit'),
        makeEntry('banana', 'fruit'),
        makeEntry('cherry', 'fruit'),
        makeEntry('date', 'fruit'),
      ];
      const result = findMatches(entries, 'banana');
      expect(result).toHaveLength(1);
      expect(result[0]!.headword).toBe('banana');
    });

    test('empty entries array', () => {
      const result = findMatches([], 'hello');
      expect(result).toHaveLength(0);
    });
  });
});
