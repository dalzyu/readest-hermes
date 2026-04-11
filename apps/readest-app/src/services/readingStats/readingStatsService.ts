const STORAGE_KEY = 'readest:reading-sessions:v1';
const GOALS_KEY = 'readest:reading-goals:v1';

export interface DailyGoals {
  /** Daily reading time goal in minutes (0 = no goal) */
  timeGoalMinutes: number;
  /** Daily page reading goal (0 = no goal) */
  pageGoal: number;
}

const DEFAULT_GOALS: DailyGoals = { timeGoalMinutes: 30, pageGoal: 20 };

export interface ReadingSession {
  bookHash: string;
  startedAt: number; // Unix ms timestamp
  endedAt: number; // Unix ms timestamp
  secondsRead: number;
  pageDelta: number;
  calendarDate: string; // YYYY-MM-DD
}

export interface DailyStats {
  date: string;
  totalSecondsRead: number;
  totalPagesRead: number;
  sessions: number;
}

/** Normalizes and validates a session before storage. Returns null if invalid. */
function normalizeSession(raw: Partial<ReadingSession>): ReadingSession | null {
  if (
    typeof raw.bookHash !== 'string' ||
    raw.bookHash.length === 0 ||
    typeof raw.startedAt !== 'number' ||
    typeof raw.endedAt !== 'number' ||
    typeof raw.secondsRead !== 'number' ||
    typeof raw.pageDelta !== 'number'
  ) {
    return null;
  }

  const duration = raw.endedAt - raw.startedAt;
  const secondsRead = Math.max(0, Math.floor(raw.secondsRead));
  const pageDelta = Math.max(0, Math.floor(raw.pageDelta));

  // Ignore zero-or-negative duration sessions
  if (duration <= 0 || secondsRead <= 0) {
    return null;
  }

  // calendarDate derived deterministically from startedAt if not provided
  const date = raw.calendarDate ?? new Date(raw.startedAt).toISOString().split('T')[0] ?? '';

  return {
    bookHash: raw.bookHash,
    startedAt: raw.startedAt,
    endedAt: raw.endedAt,
    secondsRead,
    pageDelta,
    calendarDate: date,
  };
}

function loadSessions(): ReadingSession[] {
  if (typeof localStorage === 'undefined') return [];
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw);
    if (!Array.isArray(parsed)) return [];
    return parsed.reduce<ReadingSession[]>((acc, s) => {
      const normalized = normalizeSession(s);
      if (normalized) acc.push(normalized);
      return acc;
    }, []);
  } catch {
    return [];
  }
}

function saveSessions(sessions: ReadingSession[]): void {
  if (typeof localStorage === 'undefined') return;
  localStorage.setItem(STORAGE_KEY, JSON.stringify(sessions));
}

export class ReadingStatsService {
  /** Records a completed reading session. Returns false if session was ignored. */
  recordSession(raw: Omit<ReadingSession, 'calendarDate'> & { calendarDate?: string }): boolean {
    const session = normalizeSession(raw);
    if (!session) return false;

    const sessions = loadSessions();
    sessions.push(session);
    saveSessions(sessions);
    return true;
  }

  /** Returns all stored sessions, newest first. */
  getAllSessions(): ReadingSession[] {
    return loadSessions().sort((a, b) => b.startedAt - a.startedAt);
  }

  /** Returns sessions for a specific book, newest first. */
  getSessionsByBook(bookHash: string): ReadingSession[] {
    return loadSessions()
      .filter((s) => s.bookHash === bookHash)
      .sort((a, b) => b.startedAt - a.startedAt);
  }

  /** Returns aggregated stats grouped by calendar date, newest first. */
  getDailyStats(goals?: DailyGoals): DailyStats[] {
    void goals;
    const sessions = loadSessions();
    const byDate = new Map<string, { secondsRead: number; pageDelta: number; count: number }>();

    for (const session of sessions) {
      const existing = byDate.get(session.calendarDate) ?? {
        secondsRead: 0,
        pageDelta: 0,
        count: 0,
      };
      byDate.set(session.calendarDate, {
        secondsRead: existing.secondsRead + session.secondsRead,
        pageDelta: existing.pageDelta + session.pageDelta,
        count: existing.count + 1,
      });
    }

    return Array.from(byDate.entries())
      .map(([date, stats]) => ({
        date,
        totalSecondsRead: stats.secondsRead,
        totalPagesRead: stats.pageDelta,
        sessions: stats.count,
      }))
      .sort((a, b) => b.date.localeCompare(a.date));
  }

  getGoals(): DailyGoals {
    if (typeof localStorage === 'undefined') return { ...DEFAULT_GOALS };

    try {
      const raw = localStorage.getItem(GOALS_KEY);
      if (!raw) return { ...DEFAULT_GOALS };

      const parsed = JSON.parse(raw) as Partial<DailyGoals>;
      return {
        timeGoalMinutes:
          typeof parsed.timeGoalMinutes === 'number' && parsed.timeGoalMinutes >= 0
            ? parsed.timeGoalMinutes
            : DEFAULT_GOALS.timeGoalMinutes,
        pageGoal:
          typeof parsed.pageGoal === 'number' && parsed.pageGoal >= 0
            ? parsed.pageGoal
            : DEFAULT_GOALS.pageGoal,
      };
    } catch {
      return { ...DEFAULT_GOALS };
    }
  }

  setGoals(goals: Partial<DailyGoals>): DailyGoals {
    const current = this.getGoals();
    const updated: DailyGoals = {
      timeGoalMinutes:
        goals.timeGoalMinutes !== undefined
          ? Math.max(0, Math.floor(goals.timeGoalMinutes))
          : current.timeGoalMinutes,
      pageGoal:
        goals.pageGoal !== undefined ? Math.max(0, Math.floor(goals.pageGoal)) : current.pageGoal,
    };

    if (typeof localStorage !== 'undefined') {
      localStorage.setItem(GOALS_KEY, JSON.stringify(updated));
    }

    return updated;
  }

  /** Returns current streak: consecutive days meeting the goal threshold. */
  getCurrentStreak(dailyStats: DailyStats[], goals?: DailyGoals, today = new Date()): number {
    const g = goals ?? { timeGoalMinutes: 0, pageGoal: 0 };
    const hasGoal = g.timeGoalMinutes > 0 || g.pageGoal > 0;

    function dayMeetsGoal(stat: DailyStats): boolean {
      if (!hasGoal) return true;

      const meetsTime =
        g.timeGoalMinutes > 0 ? stat.totalSecondsRead >= g.timeGoalMinutes * 60 : false;
      const meetsPages = g.pageGoal > 0 ? stat.totalPagesRead >= g.pageGoal : false;

      return meetsTime || meetsPages;
    }

    const qualifyingDates = new Set(dailyStats.filter(dayMeetsGoal).map((stat) => stat.date));
    const cursor = new Date(
      Date.UTC(today.getUTCFullYear(), today.getUTCMonth(), today.getUTCDate()),
    );
    let streak = 0;
    const getKey = (date: Date) => date.toISOString().slice(0, 10);

    while (qualifyingDates.has(getKey(cursor))) {
      streak += 1;
      cursor.setUTCDate(cursor.getUTCDate() - 1);
    }

    return streak;
  }

  /** Clears all stored sessions. */
  clearAll(): void {
    if (typeof localStorage !== 'undefined') {
      localStorage.removeItem(STORAGE_KEY);
    }
  }
}

// Singleton instance
export const readingStatsService = new ReadingStatsService();
