import { describe, expect, test } from 'vitest';
import {
  classifyExampleMatch,
  findExampleMatchRanges,
} from '@/services/contextTranslation/exampleMatcher';

describe('exampleMatcher', () => {
  test('classifies literal substring matches as exact', () => {
    expect(classifyExampleMatch('殿下，请下令吧。', '殿下')).toEqual({
      kind: 'exact',
      matchedText: '殿下',
    });
  });

  test('classifies spacing-normalized matches as variant', () => {
    expect(classifyExampleMatch('他始终守在身 侧。', '身侧')).toEqual({
      kind: 'variant',
      matchedText: '身 侧',
    });
  });

  test('classifies inflected latin matches as variant', () => {
    expect(classifyExampleMatch('He studied harder than before.', 'study')).toEqual({
      kind: 'variant',
      matchedText: 'studied',
    });
  });

  test('returns no match when the example does not contain the selected term', () => {
    expect(classifyExampleMatch('众人纷纷后退。', '殿下')).toEqual({
      kind: 'none',
      matchedText: null,
    });
  });

  test('returns highlight ranges for variant matches', () => {
    expect(findExampleMatchRanges('他始终守在身 侧。', '身侧')).toEqual([
      { start: 5, end: 8, kind: 'variant' },
    ]);
  });
});
