import { cleanup, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';

import BookDetailView from '@/components/metadata/BookDetailView';
import { Book } from '@/types/book';

let isDesktopApp = true;

vi.mock('@/hooks/useTranslation', () => ({
  useTranslation: () => (key: string) => key,
}));

vi.mock('@/context/EnvContext', () => ({
  useEnv: () => ({ envConfig: {}, appService: { isDesktopApp } }),
}));

vi.mock('@/store/settingsStore', () => ({
  useSettingsStore: () => ({
    settings: {
      metadataSeriesCollapsed: true,
      metadataOthersCollapsed: false,
      metadataDescriptionCollapsed: true,
    },
  }),
}));

vi.mock('@/helpers/settings', () => ({
  saveSysSettings: vi.fn(),
}));

vi.mock('@/components/BookCover', () => ({
  default: () => <div>cover</div>,
}));

vi.mock('@/components/metadata/BookAudioSection', () => ({
  default: ({ isDesktop }: { isDesktop: boolean }) =>
    isDesktop ? <div>Audiobook section</div> : <div>Hidden audiobook section</div>,
}));

afterEach(() => {
  cleanup();
  isDesktopApp = true;
});

function makeBook(overrides: Partial<Book> = {}): Book {
  return {
    hash: 'book-1',
    format: 'EPUB',
    title: 'Example Book',
    author: 'Example Author',
    createdAt: 1,
    updatedAt: 2,
    ...overrides,
  };
}

describe('BookDetailView audiobook surface', () => {
  it('shows the audiobook section for desktop app service', () => {
    render(<BookDetailView book={makeBook()} metadata={null} fileSize={1024} />);

    expect(screen.getByText('Audiobook section')).toBeTruthy();
  });

  it('hides the desktop audiobook surface outside desktop builds', () => {
    isDesktopApp = false;

    render(<BookDetailView book={makeBook()} metadata={null} fileSize={1024} />);

    expect(screen.queryByText('Audiobook section')).toBeNull();
    expect(screen.getByText('Hidden audiobook section')).toBeTruthy();
  });
});
