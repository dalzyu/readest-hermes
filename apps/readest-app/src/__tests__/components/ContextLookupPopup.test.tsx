import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';

import ContextLookupPopup from '@/components/ContextLookupPopup';

vi.mock('@/components/Popup', () => ({
  default: ({ children }: { children: React.ReactNode }) => <div>{children}</div>,
}));

vi.mock('@/hooks/useTranslation', () => ({
  useTranslation: () => (value: string) => value,
}));

const defaultProps = {
  selectedText: '身侧',
  selectedTextPinyin: 'shēn cè',
  retrievalStatusMeta: {
    label: 'Cross-volume context',
    className: 'status-class',
  },
  retrievalInfoText: 'Info text',
  loading: false,
  aiEnabled: true,
  hasDisplayedResult: true,
  availabilityHint: 'ai-on' as const,
  onSpeakSelectedText: vi.fn(),
  askAboutThisEnabled: true,
  onAskAboutThis: vi.fn(),
  saveEnabled: true,
  saved: false,
  onSave: vi.fn(),
  position: { point: { x: 0, y: 0 } },
  trianglePosition: { point: { x: 0, y: 0 } },
  popupWidth: 400,
  popupHeight: 260,
  children: <div>Body</div>,
};

describe('ContextLookupPopup', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  afterEach(() => {
    cleanup();
  });

  test('renders shared header actions and disabled notice behavior', () => {
    render(<ContextLookupPopup {...defaultProps} />);

    expect(screen.getByText('身侧')).toBeTruthy();
    expect(screen.getByText('shēn cè')).toBeTruthy();
    expect(screen.getByText('Cross-volume context')).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Ask About This' })).toBeTruthy();
    expect(screen.getByTitle('Save to vocabulary')).toBeTruthy();
    expect(screen.getByText('Body')).toBeTruthy();
  });

  test('dispatches shared actions from header controls', () => {
    render(<ContextLookupPopup {...defaultProps} />);

    fireEvent.click(screen.getByRole('button', { name: 'Speak' }));
    fireEvent.click(screen.getByRole('button', { name: 'Ask About This' }));
    fireEvent.click(screen.getByTitle('Save to vocabulary'));

    expect(defaultProps.onSpeakSelectedText).toHaveBeenCalledTimes(1);
    expect(defaultProps.onAskAboutThis).toHaveBeenCalledTimes(1);
    expect(defaultProps.onSave).toHaveBeenCalledTimes(1);
  });

  test.each([
    {
      hint: 'ai-off-with-translator' as const,
      message: 'Enable AI for contextual meaning and richer context.',
    },
    {
      hint: 'ai-off-empty' as const,
      message: 'AI is unavailable and no non-AI source can fill this result.',
    },
    {
      hint: 'ai-request-failed' as const,
      message: 'AI request failed. Showing dictionary/translator results only.',
    },
    {
      hint: 'partial-no-ai' as const,
      message: 'Enable AI for usage examples and grammar.',
    },
  ])('renders contextual availability message for $hint', ({ hint, message }) => {
    render(<ContextLookupPopup {...defaultProps} availabilityHint={hint} />);

    expect(screen.getByText(message)).toBeTruthy();
  });

  test('disables Ask About This unless AI is on', () => {
    render(
      <ContextLookupPopup
        {...defaultProps}
        availabilityHint='partial-no-ai'
        askAboutThisEnabled={true}
      />,
    );

    const askButton = screen.getByRole('button', { name: 'Ask About This' }) as HTMLButtonElement;
    expect(askButton.disabled).toBe(true);
  });
});
