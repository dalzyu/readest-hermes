import clsx from 'clsx';
import React, { useEffect, useMemo, useState } from 'react';

import { useTranslation } from '@/hooks/useTranslation';
import { readingStatsService, type DailyStats } from '@/services/readingStats/readingStatsService';

interface LibraryStatsCardProps {
  className?: string;
}

function formatDuration(totalSeconds: number): string {
  const totalMinutes = Math.floor(totalSeconds / 60);

  if (totalSeconds > 0 && totalMinutes === 0) return '1m';

  const hours = Math.floor(totalMinutes / 60);
  const minutes = totalMinutes % 60;

  if (hours === 0) return `${minutes}m`;
  if (minutes === 0) return `${hours}h`;
  return `${hours}h ${minutes}m`;
}

function getUtcDateKey(date: Date): string {
  return date.toISOString().slice(0, 10);
}

function getCurrentStreak(dailyStats: DailyStats[], today = new Date()): number {
  const dates = new Set(dailyStats.map((stat) => stat.date));
  const cursor = new Date(
    Date.UTC(today.getUTCFullYear(), today.getUTCMonth(), today.getUTCDate()),
  );
  let streak = 0;

  while (dates.has(getUtcDateKey(cursor))) {
    streak += 1;
    cursor.setUTCDate(cursor.getUTCDate() - 1);
  }

  return streak;
}

function getTodayStats(dailyStats: DailyStats[], today = new Date()): DailyStats | undefined {
  const todayKey = getUtcDateKey(today);
  return dailyStats.find((stat) => stat.date === todayKey);
}

const LibraryStatsCard: React.FC<LibraryStatsCardProps> = ({ className }) => {
  const _ = useTranslation();
  const [dailyStats, setDailyStats] = useState<DailyStats[]>([]);

  useEffect(() => {
    setDailyStats(readingStatsService.getDailyStats());
  }, []);

  const summary = useMemo(() => {
    if (dailyStats.length === 0) return null;

    const todayStats = getTodayStats(dailyStats);
    const currentStreak = getCurrentStreak(dailyStats);

    return {
      todayRead: formatDuration(todayStats?.totalSecondsRead ?? 0),
      pagesRead: todayStats?.totalPagesRead ?? 0,
      sessions: todayStats?.sessions ?? 0,
      currentStreak,
    };
  }, [dailyStats]);

  if (!summary) return null;

  return (
    <article
      className={clsx('bg-base-100 border-base-300 rounded-2xl border p-4 shadow-sm', className)}
    >
      <div className='mb-3 flex items-start justify-between gap-3'>
        <div className='min-w-0'>
          <h3 className='truncate text-base font-semibold'>{_('Reading stats')}</h3>
          <p className='text-base-content/60 text-sm'>{_('From saved reading sessions')}</p>
        </div>
      </div>

      <dl className='grid grid-cols-2 gap-3 sm:grid-cols-4'>
        <div className='bg-base-200/60 rounded-xl px-3 py-2'>
          <dt className='text-base-content/60 text-xs font-medium uppercase tracking-wide'>
            {_('Today')}
          </dt>
          <dd className='mt-1 text-lg font-semibold' data-testid='library-stats-today'>
            {summary.todayRead}
          </dd>
        </div>
        <div className='bg-base-200/60 rounded-xl px-3 py-2'>
          <dt className='text-base-content/60 text-xs font-medium uppercase tracking-wide'>
            {_('Pages')}
          </dt>
          <dd className='mt-1 text-lg font-semibold' data-testid='library-stats-pages'>
            {summary.pagesRead}
          </dd>
        </div>
        <div className='bg-base-200/60 rounded-xl px-3 py-2'>
          <dt className='text-base-content/60 text-xs font-medium uppercase tracking-wide'>
            {_('Sessions')}
          </dt>
          <dd className='mt-1 text-lg font-semibold' data-testid='library-stats-sessions'>
            {summary.sessions}
          </dd>
        </div>
        <div className='bg-base-200/60 rounded-xl px-3 py-2'>
          <dt className='text-base-content/60 text-xs font-medium uppercase tracking-wide'>
            {_('Streak')}
          </dt>
          <dd className='mt-1 text-lg font-semibold' data-testid='library-stats-streak'>
            {summary.currentStreak} {summary.currentStreak === 1 ? _('day') : _('days')}
          </dd>
        </div>
      </dl>
    </article>
  );
};

export default LibraryStatsCard;
