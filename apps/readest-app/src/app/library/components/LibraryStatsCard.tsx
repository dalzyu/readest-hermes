import clsx from 'clsx';
import React, { useEffect, useMemo, useState } from 'react';

import { useTranslation } from '@/hooks/useTranslation';
import {
  readingStatsService,
  type DailyGoals,
  type DailyStats,
} from '@/services/readingStats/readingStatsService';

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

function formatLocalDateKey(date: Date): string {
  const y = date.getFullYear();
  const m = String(date.getMonth() + 1).padStart(2, '0');
  const d = String(date.getDate()).padStart(2, '0');
  return `${y}-${m}-${d}`;
}

function getTodayStats(dailyStats: DailyStats[], today = new Date()): DailyStats | undefined {
  const todayKey = formatLocalDateKey(today);
  return dailyStats.find((stat) => stat.date === todayKey);
}

function goalPct(current: number, goal: number): number {
  if (goal <= 0) return 0;
  return Math.min(100, Math.round((current / goal) * 100));
}

const LibraryStatsCard: React.FC<LibraryStatsCardProps> = ({ className }) => {
  const _ = useTranslation();
  const [dailyStats, setDailyStats] = useState<DailyStats[]>([]);
  const [goals, setGoals] = useState<DailyGoals>(() => readingStatsService.getGoals());
  const [isEditingGoals, setIsEditingGoals] = useState(false);
  const [editTime, setEditTime] = useState(0);
  const [editPages, setEditPages] = useState(0);

  useEffect(() => {
    setDailyStats(readingStatsService.getDailyStats());
  }, []);

  const summary = useMemo(() => {
    const todayStats = getTodayStats(dailyStats);
    const currentStreak = readingStatsService.getCurrentStreak(dailyStats, goals);
    const todaySeconds = todayStats?.totalSecondsRead ?? 0;
    const todayPages = todayStats?.totalPagesRead ?? 0;

    return {
      todayRead: formatDuration(todaySeconds),
      pagesRead: todayPages,
      sessions: todayStats?.sessions ?? 0,
      currentStreak,
      timeGoalPct:
        goals.timeGoalMinutes > 0 ? goalPct(todaySeconds, goals.timeGoalMinutes * 60) : null,
      pageGoalPct: goals.pageGoal > 0 ? goalPct(todayPages, goals.pageGoal) : null,
    };
  }, [dailyStats, goals]);

  const handleEditGoals = () => {
    setEditTime(goals.timeGoalMinutes);
    setEditPages(goals.pageGoal);
    setIsEditingGoals(true);
  };

  const handleSaveGoals = () => {
    const updated = readingStatsService.setGoals({
      timeGoalMinutes: editTime,
      pageGoal: editPages,
    });
    setGoals(updated);
    setIsEditingGoals(false);
  };

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

      {(summary.timeGoalPct !== null || summary.pageGoalPct !== null) && (
        <div className='mt-3 space-y-2' data-testid='library-stats-goals'>
          {summary.timeGoalPct !== null && (
            <div>
              <div className='mb-1 flex items-center justify-between text-xs'>
                <span className='text-base-content/60'>{_('Daily time goal')}</span>
                <span className='text-base-content/60'>{`${summary.timeGoalPct}%`}</span>
              </div>
              <progress
                className='progress progress-primary w-full'
                value={summary.timeGoalPct}
                max={100}
                data-testid='library-stats-time-goal-pct'
              />
            </div>
          )}
          {summary.pageGoalPct !== null && (
            <div>
              <div className='mb-1 flex items-center justify-between text-xs'>
                <span className='text-base-content/60'>{_('Daily page goal')}</span>
                <span className='text-base-content/60'>{`${summary.pageGoalPct}%`}</span>
              </div>
              <progress
                className='progress progress-secondary w-full'
                value={summary.pageGoalPct}
                max={100}
                data-testid='library-stats-page-goal-pct'
              />
            </div>
          )}
        </div>
      )}

      {isEditingGoals ? (
        <div
          className='mt-3 flex flex-wrap items-end gap-2'
          data-testid='library-stats-goal-editor'
        >
          <label className='flex flex-col gap-1 text-xs'>
            <span className='text-base-content/60'>{_('Time goal (min/day)')}</span>
            <input
              type='number'
              min={0}
              max={1440}
              className='input input-bordered input-xs w-24'
              value={editTime}
              onChange={(e) => setEditTime(Math.max(0, Math.floor(Number(e.target.value))))}
              data-testid='library-stats-edit-time'
            />
          </label>
          <label className='flex flex-col gap-1 text-xs'>
            <span className='text-base-content/60'>{_('Page goal (pages/day)')}</span>
            <input
              type='number'
              min={0}
              max={10000}
              className='input input-bordered input-xs w-24'
              value={editPages}
              onChange={(e) => setEditPages(Math.max(0, Math.floor(Number(e.target.value))))}
              data-testid='library-stats-edit-pages'
            />
          </label>
          <button className='btn btn-primary btn-xs' onClick={handleSaveGoals}>
            {_('Save')}
          </button>
          <button className='btn btn-ghost btn-xs' onClick={() => setIsEditingGoals(false)}>
            {_('Cancel')}
          </button>
        </div>
      ) : (
        <div className='mt-3 flex justify-end'>
          <button
            className='btn btn-ghost btn-xs text-base-content/40'
            onClick={handleEditGoals}
            data-testid='library-stats-edit-goals-btn'
          >
            {_('Edit goals')}
          </button>
        </div>
      )}
    </article>
  );
};

export default LibraryStatsCard;
