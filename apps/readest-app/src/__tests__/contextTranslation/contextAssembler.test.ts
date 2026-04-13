import { describe, expect, test } from 'vitest';

import { assemblePopupLocalContext } from '@/services/contextTranslation/contextAssembler';

describe('assemblePopupLocalContext', () => {
  const pages = [
    { pageNumber: 1, text: 'Page one content with some words.' },
    { pageNumber: 2, text: 'Page two content with more words.' },
    {
      pageNumber: 3,
      text: 'Page three content with the selected word 知己 and several words after it for look ahead.',
    },
    { pageNumber: 4, text: 'Page four content that comes after.' },
    { pageNumber: 5, text: 'Page five content way after.' },
  ];

  test('returns bounded local context from the last N pages up to the selected text', () => {
    const result = assemblePopupLocalContext(pages, {
      currentPage: 3,
      windowSize: 3,
      selectedText: '知己',
      lookAheadWords: 0,
    });

    expect(result.localPastContext).toContain('Page one content');
    expect(result.localPastContext).toContain('Page two content');
    expect(result.localPastContext).toContain('selected word 知己');
    expect(result.localPastContext).not.toContain('and several words after');
    expect(result.windowStartPage).toBe(1);
  });

  test('adds a separate future buffer after the selected text', () => {
    const result = assemblePopupLocalContext(pages, {
      currentPage: 3,
      windowSize: 2,
      selectedText: '知己',
      lookAheadWords: 5,
    });

    expect(result.localPastContext).toContain('Page two content');
    expect(result.localPastContext).not.toContain('and several words after');
    expect(result.localFutureBuffer).toContain('and several words after it');
    expect(result.localFutureBuffer).not.toContain('Page four content');
  });

  test('handles fewer pages than requested window', () => {
    const result = assemblePopupLocalContext(pages, {
      currentPage: 2,
      windowSize: 10,
      selectedText: 'missing',
      lookAheadWords: 0,
    });

    expect(result.localPastContext).toContain('Page one content');
    expect(result.localPastContext).toContain('Page two content');
    expect(result.localPastContext).not.toContain('Page three content');
  });

  test('spills the future buffer onto later pages when needed', () => {
    const result = assemblePopupLocalContext(pages, {
      currentPage: 3,
      windowSize: 2,
      selectedText: '知己',
      lookAheadWords: 20,
    });

    expect(result.localFutureBuffer).toContain('Page four content');
  });

  test('returns empty sections for empty pages array', () => {
    const result = assemblePopupLocalContext([], {
      currentPage: 1,
      windowSize: 3,
      selectedText: '知己',
      lookAheadWords: 5,
    });

    expect(result.localPastContext).toBe('');
    expect(result.localFutureBuffer).toBe('');
  });

  test('joins pages with newline separator in the past context', () => {
    const result = assemblePopupLocalContext(pages, {
      currentPage: 2,
      windowSize: 2,
      selectedText: 'missing',
      lookAheadWords: 0,
    });

    expect(result.localPastContext).toContain('\n');
  });
});
