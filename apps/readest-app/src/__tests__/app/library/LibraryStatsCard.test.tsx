import { cleanup, fireEvent, render, screen, within } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest';

import LibraryStatsCard from '@/app/library/components/LibraryStatsCard';
import { readingStatsService, type DailyGoals } from '@/services/readingStats/readingStatsService';

vi.mock('@/hooks/useTranslation', () => ({
  useTranslation: () => (value: string) => value,
}));

vi.mock('@/services/readingStats/readingStatsService', () => ({
  readingStatsService: {
    getDailyStats: vi.fn(),
    getGoals: vi.fn(),
    setGoals: vi.fn(),
    getCurrentStreak: vi.fn(),
  },
}));

const mockGetDailyStats = vi.mocked(readingStatsService.getDailyStats);
const mockGetGoals = vi.mocked(readingStatsService.getGoals);
const mockSetGoals = vi.mocked(readingStatsService.setGoals);
const mockGetCurrentStreak = vi.mocked(readingStatsService.getCurrentStreak);

const NO_GOALS: DailyGoals = { timeGoalMinutes: 0, pageGoal: 0 };

describe('LibraryStatsCard', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2024-01-15T12:00:00Z'));
    mockGetDailyStats.mockReset();
    mockGetGoals.mockReturnValue(NO_GOALS);
    mockSetGoals.mockImplementation((partial) => ({
      timeGoalMinutes: partial.timeGoalMinutes ?? 0,
      pageGoal: partial.pageGoal ?? 0,
    }));
    mockGetCurrentStreak.mockReturnValue(0);
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
    mockGetCurrentStreak.mockReturnValue(3);

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
    mockGetCurrentStreak.mockReturnValue(0);

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

  test('shows time goal progress bar when timeGoalMinutes > 0', () => {
    mockGetDailyStats.mockReturnValue([
      { date: '2024-01-15', totalSecondsRead: 1800, totalPagesRead: 10, sessions: 1 },
    ]);
    mockGetGoals.mockReturnValue({ timeGoalMinutes: 30, pageGoal: 0 });
    mockGetCurrentStreak.mockReturnValue(1);

    render(<LibraryStatsCard />);

    // 1800s read / (30 * 60)s goal = 100%
    const pct = screen.getByTestId('library-stats-time-goal-pct');
    expect(pct.getAttribute('value')).toBe('100');
    expect(screen.queryByTestId('library-stats-page-goal-pct')).toBeNull();
  });

  test('shows page goal progress bar when pageGoal > 0', () => {
    mockGetDailyStats.mockReturnValue([
      { date: '2024-01-15', totalSecondsRead: 0, totalPagesRead: 10, sessions: 1 },
    ]);
    mockGetGoals.mockReturnValue({ timeGoalMinutes: 0, pageGoal: 20 });
    mockGetCurrentStreak.mockReturnValue(0);

    render(<LibraryStatsCard />);

    // 10 pages / 20 goal = 50%
    const pct = screen.getByTestId('library-stats-page-goal-pct');
    expect(pct.getAttribute('value')).toBe('50');
    expect(screen.queryByTestId('library-stats-time-goal-pct')).toBeNull();
  });

  test('shows no goal bars when both goals are zero', () => {
    mockGetDailyStats.mockReturnValue([
      { date: '2024-01-15', totalSecondsRead: 3600, totalPagesRead: 20, sessions: 2 },
    ]);
    mockGetGoals.mockReturnValue(NO_GOALS);

    render(<LibraryStatsCard />);

    expect(screen.queryByTestId('library-stats-goals')).toBeNull();
  });

  test('inline goal editor saves updated goals', () => {
    mockGetDailyStats.mockReturnValue([
      { date: '2024-01-15', totalSecondsRead: 0, totalPagesRead: 0, sessions: 1 },
    ]);
    mockGetGoals.mockReturnValue({ timeGoalMinutes: 30, pageGoal: 20 });
    mockSetGoals.mockReturnValue({ timeGoalMinutes: 45, pageGoal: 20 });

    render(<LibraryStatsCard />);

    fireEvent.click(screen.getByTestId('library-stats-edit-goals-btn'));

    const timeInput = screen.getByTestId('library-stats-edit-time');
    fireEvent.change(timeInput, { target: { value: '45' } });

    fireEvent.click(screen.getByRole('button', { name: 'Save' }));

    expect(mockSetGoals).toHaveBeenCalledWith(expect.objectContaining({ timeGoalMinutes: 45 }));
    // Editor closes after save
    expect(screen.queryByTestId('library-stats-goal-editor')).toBeNull();
  });

  test('passes goals to getCurrentStreak for goal-based streak calculation', () => {
    const goals: DailyGoals = { timeGoalMinutes: 30, pageGoal: 0 };
    mockGetDailyStats.mockReturnValue([
      { date: '2024-01-15', totalSecondsRead: 1800, totalPagesRead: 5, sessions: 1 },
    ]);
    mockGetGoals.mockReturnValue(goals);
    mockGetCurrentStreak.mockReturnValue(1);

    render(<LibraryStatsCard />);

    expect(mockGetCurrentStreak).toHaveBeenCalledWith(expect.any(Array), goals);
  });
});
