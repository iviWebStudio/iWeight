import { isValidTimeZone } from '@weight-ai/core';
import type { Me, PatchMe } from '@weight-ai/contracts';
import type { Db } from '../db.js';
import { badRequest, notFound } from '../errors.js';
import { iso } from './context.js';

interface Row {
  id: string;
  display_name: string | null;
  timezone: string;
  weight_unit: 'kg' | 'lb';
  height_cm: number | null;
  onboarded_at: Date | null;
  language: 'ru' | 'en' | 'hy';
  report_format: 'brief' | 'standard' | 'detailed';
  agent_tone: 'neutral' | 'supportive' | 'concise';
  memory_enabled: boolean;
}

export async function getMe(db: Db, userId: string): Promise<Me> {
  const r = await db.query<Row>(
    `select p.id, p.display_name, p.timezone, p.weight_unit, p.height_cm, p.onboarded_at,
            u.language, u.report_format, u.agent_tone, u.memory_enabled
       from profiles p join user_preferences u on u.user_id = p.id
      where p.id = $1`,
    [userId],
  );
  const row = r.rows[0];
  if (!row) throw notFound('Profile');
  return {
    id: row.id,
    displayName: row.display_name,
    timezone: row.timezone,
    weightUnit: row.weight_unit,
    heightCm: row.height_cm,
    onboardedAt: iso(row.onboarded_at),
    preferences: {
      language: row.language,
      reportFormat: row.report_format,
      agentTone: row.agent_tone,
      memoryEnabled: row.memory_enabled,
    },
  };
}

export async function patchMe(db: Db, userId: string, patch: PatchMe): Promise<Me> {
  if (patch.timezone !== undefined && !isValidTimeZone(patch.timezone)) {
    throw badRequest('Unknown time zone', [
      { path: 'timezone', message: 'Use an IANA name such as Europe/Moscow' },
    ]);
  }
  const sets: string[] = [];
  const vals: unknown[] = [];
  const add = (col: string, v: unknown) => {
    vals.push(v);
    sets.push(`${col} = $${vals.length}`);
  };
  if (patch.displayName !== undefined) add('display_name', patch.displayName);
  if (patch.timezone !== undefined) add('timezone', patch.timezone);
  if (patch.weightUnit !== undefined) add('weight_unit', patch.weightUnit);
  if (patch.heightCm !== undefined) add('height_cm', patch.heightCm);
  if (patch.onboarded !== undefined)
    sets.push(
      patch.onboarded ? 'onboarded_at = coalesce(onboarded_at, now())' : 'onboarded_at = null',
    );
  if (sets.length) {
    vals.push(userId);
    const r = await db.query(
      `update profiles set ${sets.join(', ')} where id = $${vals.length}`,
      vals,
    );
    if (r.rowCount === 0) throw notFound('Profile');
  }
  const pr = patch.preferences;
  if (pr && Object.keys(pr).length) {
    const s: string[] = [];
    const v: unknown[] = [];
    const map = {
      language: 'language',
      reportFormat: 'report_format',
      agentTone: 'agent_tone',
      memoryEnabled: 'memory_enabled',
    } as const;
    for (const [k, col] of Object.entries(map)) {
      const val = pr[k as keyof typeof pr];
      if (val !== undefined) {
        v.push(val);
        s.push(`${col} = $${v.length}`);
      }
    }
    v.push(userId);
    await db.query(`update user_preferences set ${s.join(', ')} where user_id = $${v.length}`, v);
  }
  return getMe(db, userId);
}

/** Deletes the caller's account; every owned row goes via ON DELETE CASCADE. */
export async function deleteAccount(db: Db): Promise<void> {
  await db.query('select public.delete_current_user()');
}
