import { cleanup, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';

import BookAudioSection from '@/components/metadata/BookAudioSection';
import { AudioSyncStatus, BookAudioAsset } from '@/services/audioSync/types';

vi.mock('@/hooks/useTranslation', () => ({
  useTranslation: () => (key: string) => key,
}));

afterEach(() => cleanup());

describe('BookAudioSection', () => {
  it('renders attach prompt when no audiobook is attached', () => {
    render(
      <BookAudioSection
        asset={null}
        status={null}
        busy={false}
        isDesktop
        model='large-v3'
        onAttach={vi.fn()}
        onGenerateSync={vi.fn()}
        onRemove={vi.fn()}
        onViewStatus={vi.fn()}
      />,
    );

    expect(screen.getByText('No audiobook attached')).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Attach Audiobook' })).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Generate Sync' })).toHaveProperty('disabled', true);
  });

  it('renders attached audiobook details and sync readiness', () => {
    const asset: BookAudioAsset = {
      id: 'asset-1',
      bookHash: 'book-1',
      audioHash: 'audio-1',
      originalPath: 'book-1/audio/source.mp3',
      originalFilename: 'source.mp3',
      format: 'mp3',
      durationMs: 65_000,
      chapterCount: 12,
      createdAt: 1,
      updatedAt: 2,
    };
    const status: AudioSyncStatus = {
      asset,
      map: {
        id: 'map-1',
        version: 2,
        bookHash: 'book-1',
        audioHash: 'audio-1',
        granularity: 'sentence',
        status: 'ready',
        coverage: { matchedChars: 100, totalChars: 100, matchedRatio: 1 },
        confidence: { overall: 0.95, byChapter: {} },
        segments: [],
        createdAt: 1,
        updatedAt: 2,
      },
      job: null,
      report: null,
      playable: true,
      synced: true,
      chapterFallback: false,
      syncStage: 'ready',
    };

    render(
      <BookAudioSection
        asset={asset}
        status={status}
        busy={false}
        isDesktop
        model='large-v3'
        helperState={{ state: 'ready', helperDir: '/tmp', version: '1' }}
        onAttach={vi.fn()}
        onGenerateSync={vi.fn()}
        onRemove={vi.fn()}
        onViewStatus={vi.fn()}
      />,
    );

    expect(screen.getByText('Sync ready')).toBeTruthy();
    expect(screen.getByText('source.mp3')).toBeTruthy();
    expect(screen.getByText('01:05')).toBeTruthy();
    expect(screen.getByText('12')).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Replace Audiobook' })).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Generate Sync' })).toHaveProperty('disabled', false);
  });

  it('renders a regenerate label for legacy sync sidecars', () => {
    const asset: BookAudioAsset = {
      id: 'asset-1',
      bookHash: 'book-1',
      audioHash: 'audio-1',
      originalPath: 'book-1/audio/source.mp3',
      originalFilename: 'source.mp3',
      format: 'mp3',
      durationMs: 65_000,
      chapterCount: 12,
      createdAt: 1,
      updatedAt: 2,
    };

    render(
      <BookAudioSection
        asset={asset}
        status={{
          asset,
          map: null,
          job: null,
          report: null,
          playable: true,
          synced: false,
          chapterFallback: false,
          syncStage: 'legacy',
        }}
        busy={false}
        isDesktop
        model='large-v3'
        helperState={{ state: 'ready', helperDir: '/tmp', version: '1' }}
        onAttach={vi.fn()}
        onGenerateSync={vi.fn()}
        onRemove={vi.fn()}
        onViewStatus={vi.fn()}
      />,
    );

    expect(screen.getByText('Legacy sync detected, regenerate required')).toBeTruthy();
  });
});
