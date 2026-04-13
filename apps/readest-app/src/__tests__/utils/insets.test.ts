import { describe, expect, it } from 'vitest';
import { getViewInsets } from '@/utils/insets';
import type { ViewSettings } from '@/types/book';

const baseViewSettings = {
  showHeader: true,
  showFooter: true,
  focusMode: false,
  vertical: false,
  writingMode: 'horizontal-tb',
  marginPx: 24,
  marginTopPx: 24,
  compactMarginPx: 8,
  compactMarginTopPx: 8,
  marginBottomPx: 28,
  compactMarginBottomPx: 12,
  marginLeftPx: 20,
  marginRightPx: 22,
  compactMarginLeftPx: 6,
  compactMarginRightPx: 7,
} as ViewSettings;

describe('getViewInsets', () => {
  it('uses full margins when header and footer are visible', () => {
    expect(getViewInsets(baseViewSettings)).toEqual({
      top: 24,
      right: 7,
      bottom: 28,
      left: 6,
    });
  });

  it('uses compact margins in focus mode', () => {
    expect(getViewInsets({ ...baseViewSettings, focusMode: true })).toEqual({
      top: 8,
      right: 7,
      bottom: 12,
      left: 6,
    });
  });
});
