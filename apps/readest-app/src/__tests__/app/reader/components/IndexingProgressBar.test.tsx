import { cleanup, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, test } from 'vitest';

import IndexingProgressBar from '@/app/reader/components/IndexingProgressBar';

afterEach(() => {
  cleanup();
});

describe('IndexingProgressBar', () => {
  test('keeps tiny non-zero progress visible with a 2% minimum fill', () => {
    const { container } = render(<IndexingProgressBar current={1} total={200} phase='chunking' />);

    const fill = container.querySelector('[data-indexing-fill]') as HTMLElement | null;
    expect(fill).not.toBeNull();
    expect(fill?.style.width).toBe('2%');

    const track = container.querySelector('[data-indexing-track]') as HTMLElement | null;
    expect(track).not.toBeNull();
    expect(track?.className.includes('h-1.5')).toBe(true);
    expect(track?.className.includes('sm:h-2')).toBe(true);
  });

  test('renders phase chip in a polite live region while indexing is active', () => {
    render(<IndexingProgressBar current={3} total={10} phase='embedding' />);

    const chip = screen.getByText('Embedding');
    expect(chip.getAttribute('aria-live')).toBe('polite');
  });

  test('does not render phase chip after indexing completes', () => {
    render(<IndexingProgressBar current={10} total={10} phase='complete' />);

    expect(screen.queryByText('Finalizing')).toBeNull();
    expect(screen.queryByText('Embedding')).toBeNull();
    expect(screen.queryByText('Chunking')).toBeNull();
  });
});
