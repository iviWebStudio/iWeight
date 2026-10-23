import {
  addDays,
  computeSummary,
  forecastGoal,
  toDailySeries,
  windowAverage,
  type LocalDate,
  type Summary,
} from '@weight-ai/core';
import type { AnalyticsHistory } from '@weight-ai/contracts';
import type { Db } from '../db.js';
import { badRequest } from '../errors.js';
import type { UserCtx } from './context.js';
import { activeGoal, goalInput } from './goals.js';
import { loadEntries } from './weights.js';

export async function getSummary(db: Db, ctx: UserCtx): Promise<Summary> {
  const [entries, goal] = await Promise.all([loadEntries(db), activeGoal(db)]);
  return computeSummary(entries, goalInput(goal), ctx.today);
}

export async function getHistory(
  db: Db,
  ctx: UserCtx,
  from?: LocalDate,
  to?: LocalDate,
): Promise<AnalyticsHistory> {
  const end = to ?? ctx.today;
  const start = from ?? addDays(end, -89);
  if (start > end) throw badRequest('`from` is after `to`');
  const [entries, goal] = await Promise.all([loadEntries(db), activeGoal(db)]);
  const all = toDailySeries(entries, ctx.today);
  const points = all
    .filter((p) => p.date >= start && p.date <= end)
    .map((p) => {
      const a = windowAverage(all, p.date, 7);
      return {
        date: p.date,
        weightG: p.weightG,
        entryCount: p.entryCount,
        avg7G: a.avgG,
        avg7Count: a.count,
      };
    });
  return {
    from: start,
    to: end,
    points,
    goal,
    forecast: { ...forecastGoal(all, goalInput(goal), ctx.today) },
  };
}
