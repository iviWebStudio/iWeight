import {
  addDays,
  localDateInTimeZone,
  toDailySeries,
  type DailyPoint,
  type LocalDate,
  type WeightEntryInput,
} from '@weight-ai/core';
import type { CreateWeight, PatchWeight, WeightEntry } from '@weight-ai/contracts';
import { CreateWeightSchema } from '@weight-ai/contracts';
import type { Db } from '../db.js';
import { ApiError, badRequest, notFound } from '../errors.js';
import { type UserCtx, iso, isoReq } from './context.js';

interface Row {
  id: string;
  measured_on: string;
  measured_at: Date | null;
  weight_g: number;
  note: string | null;
  source: WeightEntry['source'];
  client_entry_id: string | null;
  created_at: Date;
  updated_at: Date;
}
const COLS =
  'id, measured_on, measured_at, weight_g, note, source, client_entry_id, created_at, updated_at';

export function toEntry(r: Row): WeightEntry {
  return {
    id: r.id,
    measuredOn: r.measured_on,
    measuredAt: iso(r.measured_at),
    weightG: r.weight_g,
    note: r.note,
    source: r.source,
    clientEntryId: r.client_entry_id,
    createdAt: isoReq(r.created_at),
    updatedAt: isoReq(r.updated_at),
  };
}

/** Oldest accepted measurement date, relative to the user's today. */
const MAX_AGE_DAYS = 3653;

function checkDate(ctx: UserCtx, measuredOn: LocalDate): void {
  if (measuredOn > ctx.today) {
    throw badRequest('Date is in the future', [
      { path: 'measuredOn', message: `Latest allowed is ${ctx.today} (${ctx.timezone})` },
    ]);
  }
  if (measuredOn < addDays(ctx.today, -MAX_AGE_DAYS)) {
    throw badRequest('Date is more than 10 years ago', [
      { path: 'measuredOn', message: 'Too old' },
    ]);
  }
}

function resolveDate(
  ctx: UserCtx,
  measuredOn: LocalDate | undefined,
  measuredAt: string | null | undefined,
): LocalDate {
  if (measuredAt) {
    const fromInstant = localDateInTimeZone(new Date(measuredAt), ctx.timezone);
    if (measuredOn && measuredOn !== fromInstant) {
      throw badRequest('measuredOn does not match measuredAt in your time zone', [
        { path: 'measuredOn', message: `measuredAt falls on ${fromInstant} in ${ctx.timezone}` },
      ]);
    }
    return fromInstant;
  }
  return measuredOn ?? ctx.today;
}

export interface CreateResult {
  entry: WeightEntry;
  created: boolean;
}

export async function createWeight(
  db: Db,
  ctx: UserCtx,
  raw: CreateWeight,
  sourceOverride?: 'chat',
): Promise<CreateResult> {
  const input = CreateWeightSchema.parse(raw);
  if (input.clientEntryId) {
    const existing = await db.query<Row>(
      `select ${COLS} from weight_entries where client_entry_id = $1`,
      [input.clientEntryId],
    );
    if (existing.rows[0]) return { entry: toEntry(existing.rows[0]), created: false };
  }
  const measuredOn = resolveDate(ctx, input.measuredOn, input.measuredAt);
  checkDate(ctx, measuredOn);
  if (!input.allowDuplicate && !input.measuredAt) {
    const dup = await db.query<{ id: string }>(
      'select id from weight_entries where measured_on = $1 and weight_g = $2 limit 1',
      [measuredOn, input.weightG],
    );
    if (dup.rows[0]) {
      throw new ApiError(
        409,
        'DUPLICATE_ENTRY',
        'The same weight is already recorded for this date',
        {
          existingId: dup.rows[0].id,
          hint: 'Send allowDuplicate: true to record it anyway',
        },
      );
    }
  }
  const ins = await db.query<Row>(
    `insert into weight_entries (user_id, measured_on, measured_at, weight_g, note, source, client_entry_id)
     values ($1, $2, $3, $4, $5, $6, $7)
     on conflict (user_id, client_entry_id) where client_entry_id is not null do nothing
     returning ${COLS}`,
    [
      ctx.userId,
      measuredOn,
      input.measuredAt ?? null,
      input.weightG,
      input.note || null,
      sourceOverride ?? input.source,
      input.clientEntryId ?? null,
    ],
  );
  if (ins.rows[0]) return { entry: toEntry(ins.rows[0]), created: true };
  // Lost a race with the same clientEntryId: return the winner.
  const again = await db.query<Row>(
    `select ${COLS} from weight_entries where client_entry_id = $1`,
    [input.clientEntryId],
  );
  return { entry: toEntry(again.rows[0]!), created: false };
}

export async function getWeight(db: Db, id: string): Promise<WeightEntry> {
  const r = await db.query<Row>(`select ${COLS} from weight_entries where id = $1`, [id]);
  if (!r.rows[0]) throw notFound('Weight entry');
  return toEntry(r.rows[0]);
}

export async function updateWeight(
  db: Db,
  ctx: UserCtx,
  id: string,
  patch: PatchWeight,
): Promise<WeightEntry> {
  const cur = await db.query<Row>(`select ${COLS} from weight_entries where id = $1 for update`, [
    id,
  ]);
  const row = cur.rows[0];
  if (!row) throw notFound('Weight entry');
  let measuredAt = iso(row.measured_at);
  let measuredOn: LocalDate = row.measured_on;
  if (patch.measuredAt !== undefined) {
    measuredAt = patch.measuredAt;
    measuredOn = measuredAt
      ? resolveDate(ctx, patch.measuredOn, measuredAt)
      : (patch.measuredOn ?? row.measured_on);
  } else if (patch.measuredOn !== undefined && patch.measuredOn !== row.measured_on) {
    // Moving an entry to another day drops its old time, which belonged to the old day.
    measuredOn = patch.measuredOn;
    measuredAt = null;
  }
  if (patch.measuredAt !== undefined || patch.measuredOn !== undefined) checkDate(ctx, measuredOn);
  const r = await db.query<Row>(
    `update weight_entries set measured_on = $2, measured_at = $3, weight_g = $4, note = $5
      where id = $1 returning ${COLS}`,
    [
      id,
      measuredOn,
      measuredAt,
      patch.weightG ?? row.weight_g,
      patch.note !== undefined ? patch.note || null : row.note,
    ],
  );
  return toEntry(r.rows[0]!);
}

export async function deleteWeight(db: Db, id: string): Promise<WeightEntry> {
  const r = await db.query<Row>(`delete from weight_entries where id = $1 returning ${COLS}`, [id]);
  if (!r.rows[0]) throw notFound('Weight entry');
  return toEntry(r.rows[0]);
}

export interface ListOptions {
  from?: LocalDate;
  to?: LocalDate;
  limit: number;
  cursor?: string;
}

function decodeCursor(c: string): [string, string, string] {
  try {
    const parts = JSON.parse(Buffer.from(c, 'base64url').toString('utf8')) as unknown;
    if (Array.isArray(parts) && parts.length === 3 && parts.every((p) => typeof p === 'string'))
      return parts as [string, string, string];
  } catch {
    /* fall through */
  }
  throw badRequest('Invalid cursor');
}

export async function listWeights(
  db: Db,
  o: ListOptions,
): Promise<{ items: WeightEntry[]; nextCursor: string | null }> {
  const where: string[] = [];
  const vals: unknown[] = [];
  if (o.from) {
    vals.push(o.from);
    where.push(`measured_on >= $${vals.length}`);
  }
  if (o.to) {
    vals.push(o.to);
    where.push(`measured_on <= $${vals.length}`);
  }
  if (o.cursor) {
    const [d, c, id] = decodeCursor(o.cursor);
    vals.push(d, c, id);
    const n = vals.length;
    where.push(
      `(measured_on, created_at, id) < ($${n - 2}::date, $${n - 1}::timestamptz, $${n}::uuid)`,
    );
  }
  vals.push(o.limit + 1);
  const r = await db.query<Row>(
    `select ${COLS} from weight_entries ${where.length ? 'where ' + where.join(' and ') : ''}
      order by measured_on desc, created_at desc, id desc limit $${vals.length}`,
    vals,
  );
  const rows = r.rows.slice(0, o.limit);
  const last = rows[rows.length - 1];
  const nextCursor =
    r.rows.length > o.limit && last
      ? Buffer.from(JSON.stringify([last.measured_on, isoReq(last.created_at), last.id])).toString(
          'base64url',
        )
      : null;
  return { items: rows.map(toEntry), nextCursor };
}

/** All entries as analytics input (the core picks the morning value per day). */
export async function loadEntries(db: Db): Promise<WeightEntryInput[]> {
  const r = await db.query<{
    id: string;
    measured_on: string;
    measured_at: Date | null;
    weight_g: number;
  }>('select id, measured_on, measured_at, weight_g from weight_entries order by measured_on');
  return r.rows.map((x) => ({
    id: x.id,
    measuredOn: x.measured_on,
    measuredAt: iso(x.measured_at),
    weightG: x.weight_g,
  }));
}

export async function dailySeries(db: Db, ctx: UserCtx): Promise<DailyPoint[]> {
  return toDailySeries(await loadEntries(db), ctx.today);
}
