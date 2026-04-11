import { describe, expect, test, vi, beforeEach, afterEach } from 'vitest';
import {
  ReadingStatsService,
  readingStatsService,
  ReadingSession,
  type DailyStats,
} from '../../services/readingStats/readingStatsService';

function createMockLocalStorage() {
  let store: Record<string, string> = {};
  return {
    getItem: vi.fn((key: string) => store[key] ?? null),
    setItem: vi.fn((key: string, value: string) => {
      store[key] = value;
    }),
    removeItem: vi.fn((key: string) => {
      delete store[key];
    }),
    _getStore: () => store,
    _clearStore: () => {
      store = {};
    },
  };
}

describe('ReadingStatsService', () => {
  let mockStorage: ReturnType<typeof createMockLocalStorage>;

  beforeEach(() => {
    mockStorage = createMockLocalStorage();
    vi.stubGlobal('localStorage', mockStorage);
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  describe('recordSession', () => {
    test('records a valid session', () => {
      const service = new ReadingStatsService();
      const raw = {
        bookHash: 'abc123',
        startedAt: new Date('2024-01-15T10:00:00Z').getTime(),
        endedAt: new Date('2024-01-15T10:30:00Z').getTime(),
        secondsRead: 1800,
        pageDelta: 25,
      };

      const result = service.recordSession(raw);

      expect(result).toBe(true);
      expect(mockStorage.setItem).toHaveBeenCalled();
      const saved = JSON.parse(mockStorage._getStore()['readest:reading-sessions:v1']!);
      expect(saved).toHaveLength(1);
      expect(saved[0]!.bookHash).toBe('abc123');
      expect(saved[0]!.calendarDate).toBe('2024-01-15');
    });

    test('uses caller-supplied calendarDate if provided', () => {
      const service = new ReadingStatsService();
      const raw = {
        bookHash: 'abc123',
        startedAt: new Date('2024-01-15T10:00:00Z').getTime(),
        endedAt: new Date('2024-01-15T10:30:00Z').getTime(),
        secondsRead: 1800,
        pageDelta: 25,
        calendarDate: '2024-01-20',
      };

      service.recordSession(raw);

      const saved = JSON.parse(mockStorage._getStore()['readest:reading-sessions:v1']!);
      expect(saved[0]!.calendarDate).toBe('2024-01-20');
    });

    test('ignores zero-duration session', () => {
      const service = new ReadingStatsService();
      const raw = {
        bookHash: 'abc123',
        startedAt: new Date('2024-01-15T10:00:00Z').getTime(),
        endedAt: new Date('2024-01-15T10:00:00Z').getTime(),
        secondsRead: 0,
        pageDelta: 10,
      };

      const result = service.recordSession(raw);

      expect(result).toBe(false);
      expect(mockStorage.setItem).not.toHaveBeenCalled();
    });

    test('ignores negative-duration session', () => {
      const service = new ReadingStatsService();
      const raw = {
        bookHash: 'abc123',
        startedAt: new Date('2024-01-15T10:30:00Z').getTime(),
        endedAt: new Date('2024-01-15T10:00:00Z').getTime(),
        secondsRead: 100,
        pageDelta: 10,
      };

      const result = service.recordSession(raw);

      expect(result).toBe(false);
    });

    test('ignores zero secondsRead session', () => {
      const service = new ReadingStatsService();
      const raw = {
        bookHash: 'abc123',
        startedAt: new Date('2024-01-15T10:00:00Z').getTime(),
        endedAt: new Date('2024-01-15T10:30:00Z').getTime(),
        secondsRead: 0,
        pageDelta: 25,
      };

      const result = service.recordSession(raw);

      expect(result).toBe(false);
    });

    test('clamps negative pageDelta to zero', () => {
      const service = new ReadingStatsService();
      const raw = {
        bookHash: 'abc123',
        startedAt: new Date('2024-01-15T10:00:00Z').getTime(),
        endedAt: new Date('2024-01-15T10:30:00Z').getTime(),
        secondsRead: 1800,
        pageDelta: -10,
      };

      service.recordSession(raw);

      const saved = JSON.parse(mockStorage._getStore()['readest:reading-sessions:v1']!);
      expect(saved[0]!.pageDelta).toBe(0);
    });

    test('ignores session with empty bookHash', () => {
      const service = new ReadingStatsService();
      const raw = {
        bookHash: '',
        startedAt: new Date('2024-01-15T10:00:00Z').getTime(),
        endedAt: new Date('2024-01-15T10:30:00Z').getTime(),
        secondsRead: 1800,
        pageDelta: 25,
      };

      const result = service.recordSession(raw);

      expect(result).toBe(false);
    });
  });

  describe('goals', () => {
    test('returns default goals when storage is empty', () => {
      const service = new ReadingStatsService();

      expect(service.getGoals()).toEqual({ timeGoalMinutes: 30, pageGoal: 20 });
    });

    test('persists and returns updated goals from setGoals', () => {
      const service = new ReadingStatsService();

      const updated = service.setGoals({ timeGoalMinutes: 45 });

      expect(updated).toEqual({ timeGoalMinutes: 45, pageGoal: 20 });
      expect(JSON.parse(mockStorage._getStore()['readest:reading-goals:v1']!)).toEqual(updated);
      expect(new ReadingStatsService().getGoals()).toEqual(updated);
    });

    test('clamps negative page goal to 0', () => {
      const service = new ReadingStatsService();

      const updated = service.setGoals({ pageGoal: -5 });

      expect(updated).toEqual({ timeGoalMinutes: 30, pageGoal: 0 });
      expect(JSON.parse(mockStorage._getStore()['readest:reading-goals:v1']!)).toEqual(updated);
    });
  });

  describe('getCurrentStreak', () => {
    // Use local dates to avoid timezone-dependent failures
    function localDateStr(daysAgo: number): string {
      const d = new Date();
      d.setDate(d.getDate() - daysAgo);
      const y = d.getFullYear();
      const m = String(d.getMonth() + 1).padStart(2, '0');
      const day = String(d.getDate()).padStart(2, '0');
      return `${y}-${m}-${day}`;
    }

    test('counts only days meeting the time goal threshold', () => {
      const service = new ReadingStatsService();
      const dailyStats: DailyStats[] = [
        { date: localDateStr(0), totalSecondsRead: 1800, totalPagesRead: 0, sessions: 1 },
        { date: localDateStr(1), totalSecondsRead: 1200, totalPagesRead: 0, sessions: 1 },
        { date: localDateStr(2), totalSecondsRead: 1800, totalPagesRead: 0, sessions: 1 },
      ];

      // Only today (1800s) meets the 30-min goal; yesterday (1200s = 20min) doesn't
      expect(
        service.getCurrentStreak(dailyStats, { timeGoalMinutes: 30, pageGoal: 0 }),
      ).toBe(1);
    });

    test('counts any reading day when both goals are zero', () => {
      const service = new ReadingStatsService();
      const dailyStats: DailyStats[] = [
        { date: localDateStr(0), totalSecondsRead: 60, totalPagesRead: 1, sessions: 1 },
        { date: localDateStr(1), totalSecondsRead: 120, totalPagesRead: 2, sessions: 1 },
      ];

      expect(
        service.getCurrentStreak(dailyStats, { timeGoalMinutes: 0, pageGoal: 0 }),
      ).toBe(2);
    });

    test('streak starts from yesterday when today has not yet met the goal', () => {
      const service = new ReadingStatsService();
      const dailyStats: DailyStats[] = [
        { date: localDateStr(0), totalSecondsRead: 60, totalPagesRead: 0, sessions: 1 },
        { date: localDateStr(1), totalSecondsRead: 1800, totalPagesRead: 0, sessions: 1 },
        { date: localDateStr(2), totalSecondsRead: 1800, totalPagesRead: 0, sessions: 1 },
      ];

      // Today doesn't meet 30-min goal, but yesterday and day before do → streak = 2
      expect(
        service.getCurrentStreak(dailyStats, { timeGoalMinutes: 30, pageGoal: 0 }),
      ).toBe(2);
    });
  });

  describe('getAllSessions', () => {
    test('returns sessions sorted newest first', () => {
      const store = mockStorage._getStore();
      const sessions: ReadingSession[] = [
        {
          bookHash: 'abc',
          startedAt: new Date('2024-01-10T10:00:00Z').getTime(),
          endedAt: new Date('2024-01-10T10:30:00Z').getTime(),
          secondsRead: 1800,
          pageDelta: 20,
          calendarDate: '2024-01-10',
        },
        {
          bookHash: 'def',
          startedAt: new Date('2024-01-20T10:00:00Z').getTime(),
          endedAt: new Date('2024-01-20T10:30:00Z').getTime(),
          secondsRead: 1800,
          pageDelta: 30,
          calendarDate: '2024-01-20',
        },
      ];
      store['readest:reading-sessions:v1'] = JSON.stringify(sessions);

      const service = new ReadingStatsService();
      const result = service.getAllSessions();

      expect(result[0]!.bookHash).toBe('def');
      expect(result[1]!.bookHash).toBe('abc');
    });

    test('returns empty array when no sessions', () => {
      const service = new ReadingStatsService();
      const result = service.getAllSessions();
      expect(result).toEqual([]);
    });

    test('filters out malformed entries from storage', () => {
      const store = mockStorage._getStore();
      store['readest:reading-sessions:v1'] = JSON.stringify([
        {
          bookHash: 'valid',
          startedAt: 1000,
          endedAt: 2000,
          secondsRead: 1000,
          pageDelta: 10,
          calendarDate: '2024-01-01',
        },
        {
          bookHash: '',
          startedAt: 1000,
          endedAt: 2000,
          secondsRead: 1000,
          pageDelta: 10,
          calendarDate: '2024-01-01',
        },
      ]);

      const service = new ReadingStatsService();
      const result = service.getAllSessions();

      expect(result).toHaveLength(1);
      expect(result[0]!.bookHash).toBe('valid');
    });
  });

  describe('getSessionsByBook', () => {
    test('returns only sessions for the specified book', () => {
      const store = mockStorage._getStore();
      store['readest:reading-sessions:v1'] = JSON.stringify([
        {
          bookHash: 'abc',
          startedAt: 1000,
          endedAt: 2000,
          secondsRead: 1000,
          pageDelta: 10,
          calendarDate: '2024-01-01',
        },
        {
          bookHash: 'def',
          startedAt: 3000,
          endedAt: 4000,
          secondsRead: 1000,
          pageDelta: 20,
          calendarDate: '2024-01-02',
        },
        {
          bookHash: 'abc',
          startedAt: 5000,
          endedAt: 6000,
          secondsRead: 1000,
          pageDelta: 15,
          calendarDate: '2024-01-03',
        },
      ]);

      const service = new ReadingStatsService();
      const result = service.getSessionsByBook('abc');

      expect(result).toHaveLength(2);
      expect(result.every((s) => s.bookHash === 'abc')).toBe(true);
    });

    test('returns empty array for unknown book', () => {
      const store = mockStorage._getStore();
      store['readest:reading-sessions:v1'] = JSON.stringify([
        {
          bookHash: 'abc',
          startedAt: 1000,
          endedAt: 2000,
          secondsRead: 1000,
          pageDelta: 10,
          calendarDate: '2024-01-01',
        },
      ]);

      const service = new ReadingStatsService();
      const result = service.getSessionsByBook('xyz');

      expect(result).toEqual([]);
    });
  });

  describe('getDailyStats', () => {
    test('aggregates sessions by calendarDate', () => {
      const store = mockStorage._getStore();
      store['readest:reading-sessions:v1'] = JSON.stringify([
        {
          bookHash: 'a',
          startedAt: 1000,
          endedAt: 2000,
          secondsRead: 1000,
          pageDelta: 10,
          calendarDate: '2024-01-15',
        },
        {
          bookHash: 'b',
          startedAt: 3000,
          endedAt: 4000,
          secondsRead: 500,
          pageDelta: 5,
          calendarDate: '2024-01-15',
        },
        {
          bookHash: 'c',
          startedAt: 5000,
          endedAt: 6000,
          secondsRead: 1200,
          pageDelta: 12,
          calendarDate: '2024-01-20',
        },
      ]);

      const service = new ReadingStatsService();
      const result = service.getDailyStats();

      expect(result).toHaveLength(2);
      const jan20 = result.find((d) => d.date === '2024-01-20');
      expect(jan20?.totalSecondsRead).toBe(1200);
      expect(jan20?.totalPagesRead).toBe(12);
      expect(jan20?.sessions).toBe(1);

      const jan15 = result.find((d) => d.date === '2024-01-15');
      expect(jan15?.totalSecondsRead).toBe(1500);
      expect(jan15?.totalPagesRead).toBe(15);
      expect(jan15?.sessions).toBe(2);
    });

    test('does not produce bogus positive totals from negative page deltas', () => {
      const store = mockStorage._getStore();
      store['readest:reading-sessions:v1'] = JSON.stringify([
        {
          bookHash: 'a',
          startedAt: 1000,
          endedAt: 2000,
          secondsRead: 1000,
          pageDelta: -5,
          calendarDate: '2024-01-15',
        },
        {
          bookHash: 'b',
          startedAt: 3000,
          endedAt: 4000,
          secondsRead: 500,
          pageDelta: 10,
          calendarDate: '2024-01-15',
        },
      ]);

      const service = new ReadingStatsService();
      const result = service.getDailyStats();

      // Negative pageDelta was normalized to 0, so total should be 10
      const jan15 = result.find((d) => d.date === '2024-01-15');
      expect(jan15?.totalPagesRead).toBe(10);
    });

    test('returns empty array when no sessions', () => {
      const service = new ReadingStatsService();
      const result = service.getDailyStats();
      expect(result).toEqual([]);
    });

    test('returns stats sorted newest date first', () => {
      const store = mockStorage._getStore();
      store['readest:reading-sessions:v1'] = JSON.stringify([
        {
          bookHash: 'a',
          startedAt: 1000,
          endedAt: 2000,
          secondsRead: 1000,
          pageDelta: 10,
          calendarDate: '2024-01-10',
        },
        {
          bookHash: 'b',
          startedAt: 3000,
          endedAt: 4000,
          secondsRead: 500,
          pageDelta: 5,
          calendarDate: '2024-01-20',
        },
      ]);

      const service = new ReadingStatsService();
      const result = service.getDailyStats();

      expect(result[0]!.date).toBe('2024-01-20');
      expect(result[1]!.date).toBe('2024-01-10');
    });
  });

  describe('clearAll', () => {
    test('removes all sessions from storage', () => {
      const store = mockStorage._getStore();
      store['readest:reading-sessions:v1'] = JSON.stringify([
        {
          bookHash: 'a',
          startedAt: 1000,
          endedAt: 2000,
          secondsRead: 1000,
          pageDelta: 10,
          calendarDate: '2024-01-15',
        },
      ]);

      const service = new ReadingStatsService();
      service.clearAll();

      expect(mockStorage.removeItem).toHaveBeenCalledWith('readest:reading-sessions:v1');
    });
  });

  describe('singleton export', () => {
    test('readingStatsService is a ReadingStatsService instance', () => {
      expect(readingStatsService).toBeInstanceOf(ReadingStatsService);
    });
  });
});
