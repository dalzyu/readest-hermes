import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import DesktopFooterBar from '@/app/reader/components/footerbar/DesktopFooterBar';

const mockPlay = vi.fn().mockResolvedValue(undefined);
const mockPause = vi.fn();
let sessionMode: 'playing' | 'paused' = 'paused';
let playable = true;

vi.mock('@/hooks/useTranslation', () => ({
  useTranslation: () => (key: string) => key,
}));

vi.mock('@/context/EnvContext', () => ({
  useEnv: () => ({ appService: { isMobileApp: false } }),
}));

vi.mock('@/hooks/useAudioSync', () => ({
  useAudioSync: () => ({
    controller: { play: mockPlay, pause: mockPause },
    status: playable ? { playable: true } : null,
    reload: vi.fn(),
  }),
}));

vi.mock('@/store/audioSyncStore', () => ({
  useAudioSyncStore: () => ({
    sessionStates: {
      book1: { mode: sessionMode },
    },
  }),
}));

vi.mock('@/store/readerStore', () => ({
  useReaderStore: () => ({
    hoveredBookKey: 'book-1-reader',
    getView: () => ({ history: { canGoBack: false, canGoForward: false } }),
    getViewState: () => ({ ttsEnabled: false }),
    getProgress: () => null,
    getViewSettings: () => ({ progressStyle: 'percentage' }),
  }),
}));

vi.mock('@/store/bookDataStore', () => ({
  useBookDataStore: () => ({
    getBookData: () => ({ isFixedLayout: false }),
  }),
}));

beforeEach(() => {
  Object.defineProperty(window, 'innerWidth', { configurable: true, value: 1024 });
  Object.defineProperty(window, 'innerHeight', { configurable: true, value: 768 });
  mockPlay.mockClear();
  mockPause.mockClear();
  sessionMode = 'paused';
  playable = true;
});

afterEach(() => cleanup());

describe('DesktopFooterBar audiobook control', () => {
  it('shows a play audiobook button when a playable sync asset exists', () => {
    render(
      <DesktopFooterBar
        bookKey='book1-reader'
        gridInsets={{ top: 0, right: 0, bottom: 0, left: 0 }}
        progressValid={false}
        progressFraction={0}
        navigationHandlers={{
          onPrevPage: vi.fn(),
          onNextPage: vi.fn(),
          onPrevSection: vi.fn(),
          onNextSection: vi.fn(),
          onGoBack: vi.fn(),
          onGoForward: vi.fn(),
          onProgressChange: vi.fn(),
        }}
        forceMobileLayout={false}
        actionTab=''
        onSetActionTab={vi.fn()}
        onSpeakText={vi.fn()}
      />,
    );

    expect(screen.getByRole('button', { name: 'Play Audiobook' })).toBeTruthy();
  });

  it('pauses audiobook playback when already playing', () => {
    sessionMode = 'playing';

    render(
      <DesktopFooterBar
        bookKey='book1-reader'
        gridInsets={{ top: 0, right: 0, bottom: 0, left: 0 }}
        progressValid={false}
        progressFraction={0}
        navigationHandlers={{
          onPrevPage: vi.fn(),
          onNextPage: vi.fn(),
          onPrevSection: vi.fn(),
          onNextSection: vi.fn(),
          onGoBack: vi.fn(),
          onGoForward: vi.fn(),
          onProgressChange: vi.fn(),
        }}
        forceMobileLayout={false}
        actionTab=''
        onSetActionTab={vi.fn()}
        onSpeakText={vi.fn()}
      />,
    );

    fireEvent.click(screen.getByRole('button', { name: 'Pause Audiobook' }));
    expect(mockPause).toHaveBeenCalledTimes(1);
  });
});
