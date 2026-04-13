/**
 * Visual regression test for the AnnotationPopup component.
 *
 * Renders the *real* AnnotationPopup + HighlightOptions with actual
 * annotationToolButtons, DEFAULT_HIGHLIGHT_COLORS, and optional user
 * colors.  Tailwind CSS is loaded so the screenshot matches the live app.
 *
 * Guards against the layout regression from PR #3741 (missing
 * `justify-between`, unwanted `flex-1` on the color strip).
 */
import React from 'react';
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, cleanup } from '@testing-library/react';
import type { UserHighlightColor } from '@/types/book';
import { EnvProvider } from '@/context/EnvContext';
import { useSettingsStore } from '@/store/settingsStore';
import { DEFAULT_SYSTEM_SETTINGS } from '@/services/constants';

// ── Tailwind / DaisyUI styles ───────────────────────────────────────────
import '@/styles/globals.css';

// ── Mocks (must be before component imports) ────────────────────────────

// Environment service mock — EnvProvider reads `env.getAppService()`.
vi.mock('@/services/environment', async () => {
  const actual = await vi.importActual('@/services/environment');
  return {
    ...actual,
    default: {
      getAppService: vi.fn().mockResolvedValue({ isMobile: false }),
    },
  };
});

// EnvContext mock so useEnv() is safe to call outside the real provider.
vi.mock('@/context/EnvContext', () => ({
  EnvProvider: ({ children }: { children: React.ReactNode }) => children,
  useEnv: () => ({ envConfig: {}, appService: null }),
}));

vi.mock('@/store/themeStore', () => ({
  useThemeStore: () => ({ isDarkMode: false }),
}));

vi.mock('@/hooks/useTranslation', () => ({
  useTranslation: () => (s: string) => s,
}));

vi.mock('@/hooks/useResponsiveSize', () => ({
  useResponsiveSize: (n: number) => n,
  useDefaultIconSize: () => 20,
}));

vi.mock('@/hooks/useKeyDownActions', () => ({
  useKeyDownActions: () => {},
}));

vi.mock('@/helpers/settings', () => ({
  saveSysSettings: vi.fn(),
}));

vi.mock('@/app/reader/utils/annotatorUtil', () => ({
  getHighlightColorLabel: () => undefined,
}));

// ── Real component imports ──────────────────────────────────────────────

import AnnotationPopup from '@/app/reader/components/annotator/AnnotationPopup';
import { annotationToolButtons } from '@/app/reader/components/annotator/AnnotationTools';

// ── Constants ───────────────────────────────────────────────────────────

const POPUP_W = 300;
const POPUP_H = 44;

// Highlight options float above the popup by (28 + 16) = 44px
const OPTIONS_OFFSET = 28 + 16;

// Position the popup so both it and the floating options are visible:
//   y=0..OPTIONS_OFFSET: highlight-options row
//   y=OPTIONS_OFFSET..OPTIONS_OFFSET+POPUP_H: toolbar
const POPUP_Y = OPTIONS_OFFSET;
const POPUP_X = 0;
const WRAPPER_H = POPUP_Y + POPUP_H + 14; // +14 for triangle below

const toolButtons = annotationToolButtons.map(({ label, Icon }) => ({
  tooltipText: label,
  Icon,
  onClick: vi.fn(),
}));

/**
 * Fixed-size wrapper that contains both the popup and the absolutely
 * positioned highlight-options row above it, matching the real app
 * where the triangle points up and highlight options float above.
 */
const Wrapper: React.FC<{ children: React.ReactNode }> = ({ children }) => (
  <div
    data-theme='dark'
    style={{
      position: 'relative',
      width: POPUP_W,
      height: WRAPPER_H,
      overflow: 'visible',
    }}
  >
    {children}
  </div>
);

const renderPopup = (userColors: UserHighlightColor[] = []) => {
  // Use real Zustand store setState — no mock needed for useSettingsStore.
  // Mirrors the state shape that the original useSettingsStore mock returned:
  //   customHighlightColors = {} (empty, so default color names render as-is)
  //   highlightStyles.underline = 'red' (explicit override)
  (useSettingsStore.setState as (s: object) => void)({
    settings: {
      ...DEFAULT_SYSTEM_SETTINGS,
      globalReadSettings: {
        ...DEFAULT_SYSTEM_SETTINGS.globalReadSettings,
        highlightStyle: 'highlight',
        highlightStyles: {
          highlight: 'yellow',
          underline: 'red',
          squiggly: 'blue',
        },
        customHighlightColors: {} as Record<string, string>,
        userHighlightColors: userColors,
        defaultHighlightLabels: {},
      },
      globalViewSettings: {
        ...DEFAULT_SYSTEM_SETTINGS.globalViewSettings,
        isEink: false,
        isColorEink: false,
      },
    },
  });

  return render(
    <EnvProvider>
      <Wrapper>
        <AnnotationPopup
          bookKey='test'
          dir='ltr'
          isVertical={false}
          buttons={toolButtons}
          notes={[]}
          position={{ dir: 'up', point: { x: POPUP_X, y: POPUP_Y } }}
          trianglePosition={{
            dir: 'up',
            point: { x: POPUP_X + POPUP_W / 2, y: POPUP_Y + POPUP_H },
          }}
          highlightOptionsVisible
          selectedStyle='highlight'
          selectedColor='yellow'
          popupWidth={POPUP_W}
          popupHeight={POPUP_H}
          onHighlight={vi.fn()}
          onDismiss={vi.fn()}
        />
      </Wrapper>
    </EnvProvider>,
  );
};

const nextFrame = () => new Promise<void>((resolve) => requestAnimationFrame(() => resolve()));

const getLayoutMetrics = async (userColors: UserHighlightColor[] = []) => {
  const { container } = renderPopup(userColors);
  await nextFrame();

  const options = container.querySelector('.highlight-options') as HTMLElement | null;
  if (!options) {
    throw new Error('Expected .highlight-options element to be rendered');
  }

  const [styleButtons, colorStrip] = Array.from(options.children) as HTMLElement[];
  if (!styleButtons || !colorStrip) {
    throw new Error('Expected highlight options to render style and color groups');
  }

  const styleRect = styleButtons.getBoundingClientRect();
  const colorRect = colorStrip.getBoundingClientRect();

  return {
    options,
    colorStrip,
    gap: colorRect.left - styleRect.right,
    colorStripWidth: colorRect.width,
    colorStripClientWidth: colorStrip.clientWidth,
    colorStripScrollWidth: colorStrip.scrollWidth,
  };
};

// ── Lifecycle ───────────────────────────────────────────────────────────

beforeEach(() => {
  // Reset store state before each test.
  (useSettingsStore.setState as (s: object) => void)({ settings: DEFAULT_SYSTEM_SETTINGS });
});

afterEach(() => {
  cleanup();
});

// ── Tests ───────────────────────────────────────────────────────────────

describe('AnnotationPopup layout', () => {
  it('default 5 colors keeps a wide gap without overflow', async () => {
    const metrics = await getLayoutMetrics();

    expect(metrics.options.className).toContain('justify-between');
    expect(metrics.colorStrip.className).toContain('min-w-0');
    expect(metrics.colorStrip.className).not.toContain('flex-1');
    expect(metrics.gap).toBeGreaterThan(40);
    expect(metrics.colorStripScrollWidth).toBeLessThanOrEqual(metrics.colorStripClientWidth + 1);
  });

  it('adding 5 user colors expands the strip and shrinks the gap', async () => {
    const defaultMetrics = await getLayoutMetrics();
    cleanup();

    const expandedMetrics = await getLayoutMetrics([
      { hex: '#f97316' },
      { hex: '#06b6d4' },
      { hex: '#ec4899' },
      { hex: '#14b8a6' },
      { hex: '#f43f5e' },
    ]);

    expect(expandedMetrics.colorStripWidth).toBeGreaterThan(defaultMetrics.colorStripWidth + 20);
    expect(expandedMetrics.gap).toBeLessThan(defaultMetrics.gap - 20);
  });

  it('adding 10 user colors caps the strip width and enables overflow scrolling', async () => {
    const expandedMetrics = await getLayoutMetrics([
      { hex: '#f97316' },
      { hex: '#06b6d4' },
      { hex: '#ec4899' },
      { hex: '#14b8a6' },
      { hex: '#f43f5e' },
    ]);
    cleanup();

    const overflowMetrics = await getLayoutMetrics([
      { hex: '#f97316' },
      { hex: '#06b6d4' },
      { hex: '#ec4899' },
      { hex: '#14b8a6' },
      { hex: '#f43f5e' },
      { hex: '#a855f7' },
      { hex: '#84cc16' },
      { hex: '#0ea5e9' },
      { hex: '#e11d48' },
      { hex: '#6366f1' },
    ]);

    expect(
      Math.abs(overflowMetrics.colorStripWidth - expandedMetrics.colorStripWidth),
    ).toBeLessThanOrEqual(2);
    expect(overflowMetrics.colorStripScrollWidth).toBeGreaterThan(
      overflowMetrics.colorStripClientWidth + 20,
    );
  });
});
