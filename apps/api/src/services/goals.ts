import { goalDirection, type GoalInput } from '@weight-ai/core';
import type { CreateGoal, Goal } from '@weight-ai/contracts';
import type { Db } from '../db.js';
import { badRequest, notFound } from '../errors.js';
import { type UserCtx, iso, isoReq } from './context.js';
import { dailySeries } from './weights.js';

interface Row {
  id: string;
  start_weight_g: number;
  target_weight_g: number;
  start_date: string;
  status: Goal['status'];
  created_at: Date;
  ended_at: Date | null;
}
const COLS = 'id, start_weight_g, target_weight_g, start_date, status, created_at, ended_at';

function toGoal(r: Row): Goal {
  return {
    id: r.id,
    startWeightG: r.start_weight_g,
    targetWeightG: r.target_weight_g,
    startDate: r.start_date,
    status: r.status,
    direction: goalDirection(toGoalInput(r)),
    createdAt: isoReq(r.created_at),
    endedAt: iso(r.ended_at),
  };
}
function toGoalInput(r: Row): GoalInput {
  return {
    startWeightG: r.start_weight_g,
    targetWeightG: r.target_weight_g,
    startDate: r.start_date,
  };
}

export async function activeGoal(db: Db): Promise<Goal | null> {
  const r = await db.query<Row>(`select ${COLS} from goals where status = 'active'`);
  return r.rows[0] ? toGoal(r.rows[0]) : null;
}

export function goalInput(g: Goal | null): GoalInput | null {
  return g
    ? { startWeightG: g.startWeightG, targetWeightG: g.targetWeightG, startDate: g.startDate }
    : null;
}

/** Replaces the active goal (the old one is kept as 'replaced', ADR-008). */
export async function setGoal(db: Db, ctx: UserCtx, input: CreateGoal): Promise<Goal> {
  let startWeightG = input.startWeightG;
  const startDate = input.startDate ?? ctx.today;
  if (startDate > ctx.today) throw badRequest('Goal start date is in the future');
  if (startWeightG === undefined) {
    const series = await dailySeries(db, ctx);
    const latest = series[series.length - 1];
    if (!latest) throw badRequest('No measurements yet: pass startWeightG explicitly');
    startWeightG = latest.weightG;
  }
  await db.query(`update goals set status = 'replaced', ended_at = now() where status = 'active'`);
  const r = await db.query<Row>(
    `insert into goals (user_id, start_weight_g, target_weight_g, start_date) values ($1, $2, $3, $4) returning ${COLS}`,
    [ctx.userId, startWeightG, input.targetWeightG, startDate],
  );
  return toGoal(r.rows[0]!);
}

export async function clearGoal(db: Db): Promise<Goal> {
  const r = await db.query<Row>(
    `update goals set status = 'cancelled', ended_at = now() where status = 'active' returning ${COLS}`,
  );
  if (!r.rows[0]) throw notFound('Active goal');
  return toGoal(r.rows[0]);
}
