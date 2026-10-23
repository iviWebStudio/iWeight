import {
  isValidTimeZone,
  localDateInTimeZone,
  type LocalDate,
  type WeightUnit,
} from '@weight-ai/core';
import type { Db } from '../db.js';
import { notFound } from '../errors.js';

/** Per-request facts about the caller, read through RLS (so only their own profile is visible). */
export interface UserCtx {
  userId: string;
  timezone: string;
  unit: WeightUnit;
  displayName: string | null;
  language: 'ru' | 'en' | 'hy';
  today: LocalDate;
}

export async function loadCtx(db: Db, userId: string, now = new Date()): Promise<UserCtx> {
  const r = await db.query<{
    timezone: string;
    weight_unit: WeightUnit;
    display_name: string | null;
    language: UserCtx['language'] | null;
  }>(
    `select p.timezone, p.weight_unit, p.display_name, u.language
       from profiles p left join user_preferences u on u.user_id = p.id
      where p.id = $1`,
    [userId],
  );
  const p = r.rows[0];
  if (!p) throw notFound('Profile');
  const timezone = isValidTimeZone(p.timezone) ? p.timezone : 'UTC';
  return {
    userId,
    timezone,
    unit: p.weight_unit,
    displayName: p.display_name,
    language: p.language ?? 'ru',
    today: localDateInTimeZone(now, timezone),
  };
}

export const iso = (v: Date | string | null): string | null =>
  v === null ? null : v instanceof Date ? v.toISOString() : v;
export const isoReq = (v: Date | string): string => (v instanceof Date ? v.toISOString() : v);
