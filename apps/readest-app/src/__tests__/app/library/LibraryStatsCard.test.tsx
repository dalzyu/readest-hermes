import { cleanup, render, screen, within } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest';

import LibraryStatsCard from '@/app/library/components/LibraryStatsCard';
import { readingStatsService } from '@/services/readingStats/readingStatsService';

vi.mock('@/hooks/useTranslation', () => ({
  useTranslation: () => (value: string) => value,
}));

vi.mock('@/services/readingStats/readingStatsService', () => ({
  readingStatsService: {
    getDailyStats: vi.fn(),
  },
}));

const mockGetDailyStats = vi.mocked(readingStatsService.getDailyStats);

describe('LibraryStatsCard', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2024-01-15T12:00:00Z'));
    mockGetDailyStats.mockReset();
  });

  afterEach(() => {
    cleanup();
    vi.useRealTimers();
  });

  test('renders summary metrics from daily stats', () => {
    mockGetDailyStats.mockReturnValue([
      { date: '2024-01-15', totalSecondsRead: 3720, totalPagesRead: 12, sessions: 3 },
      { date: '2024-01-14', totalSecondsRead: 600, totalPagesRead: 4, sessions: 1 },
      { date: '2024-01-13', totalSecondsRead: 300, totalPagesRead: 2, sessions: 1 },
      { date: '2024-01-11', totalSecondsRead: 900, totalPagesRead: 8, sessions: 2 },
    ]);

    render(<LibraryStatsCard />);

    const heading = screen.getByRole('heading', { name: 'Reading stats' });
    const card = heading.closest('article');
    expect(card).toBeTruthy();

    const scope = within(card as HTMLElement);
    expect(scope.getByText('From saved reading sessions')).toBeTruthy();
    expect(scope.getByTestId('library-stats-today').textContent).toContain('1h 2m');
    expect(scope.getByTestId('library-stats-pages').textContent).toBe('12');
    expect(scope.getByTestId('library-stats-sessions').textContent).toBe('3');
    expect(scope.getByTestId('library-stats-streak').textContent).toContain('3 days');
  });

  test('shows an honest zero streak when today has no session data', () => {
    mockGetDailyStats.mockReturnValue([
      { date: '2024-01-14', totalSecondsRead: 600, totalPagesRead: 4, sessions: 1 },
      { date: '2024-01-13', totalSecondsRead: 300, totalPagesRead: 2, sessions: 1 },
    ]);

    render(<LibraryStatsCard />);

    const heading = screen.getByRole('heading', { name: 'Reading stats' });
    const card = heading.closest('article');
    expect(card).toBeTruthy();

    expect(within(card as HTMLElement).getByTestId('library-stats-streak').textContent).toContain(
      '0 days',
    );
  });

  test('rounds positive sub-minute reading time up to one minute', () => {
    mockGetDailyStats.mockReturnValue([
      { date: '2024-01-15', totalSecondsRead: 59, totalPagesRead: 1, sessions: 1 },
    ]);

    render(<LibraryStatsCard />);

    const heading = screen.getByRole('heading', { name: 'Reading stats' });
    const card = heading.closest('article');
    expect(card).toBeTruthy();

    expect(within(card as HTMLElement).getByTestId('library-stats-today').textContent).toBe('1m');
  });

  test('renders nothing when there are no stats', () => {
    mockGetDailyStats.mockReturnValue([]);

    const { container } = render(<LibraryStatsCard />);

    expect(mockGetDailyStats).toHaveBeenCalledTimes(1);
    expect(container.innerHTML).toBe('');
  });
});
