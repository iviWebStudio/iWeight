/**
 * Agent tools. Each one validates its arguments with Zod, runs in its own RLS transaction as the
 * calling user (withUser) and returns JSON with `ok`. Numbers come preformatted in the user's unit
 * so the model never has to compute or convert anything itself.
 */
import { createHash, randomUUID } from 'node:crypto';
import {
  addDays,
  daysBetween,
  formatDelta,
  formatWeight,
  isValidLocalDate,
  linearTrend,
  localTimeInTimeZone,
  zonedTimeToUtc,
  toDailySeries,
  toGrams,
  isValidWeightG,
  windowAverage,
  type LocalDate,
  type Summary,
  type WeightUnit,
} from '@weight-ai/core';
import type { PendingAction, ToolEvent } from '@weight-ai/contracts';
import type pg from 'pg';
import { z } from 'zod';
import { withUser, type Db } from '../db.js';
import { ApiError, toApiError } from '../errors.js';
import { getSummary } from '../services/analytics.js';
import { loadCtx, type UserCtx } from '../services/context.js';
import { setPendingAction } from '../services/conversations.js';
import { activeGoal, clearGoal, setGoal } from '../services/goals.js';
import { addMemory, deleteMemory, listMemory, updateMemory } from '../services/memory.js';
import { getMe } from '../services/profile.js';
import {
  createWeight,
  deleteWeight,
  getWeight,
  listWeights,
  loadEntries,
  updateWeight,
} from '../services/weights.js';
import type { ToolDefinition } from './model.js';

export interface ToolRunContext {
  pool: pg.Pool;
  userId: string;
  conversationId: string;
  /** The user message this run answers. */
  userMessageId: string;
  /** Pending action as of the start of this run; updated by delete_weight_entry. */
  pending: PendingAction | null;
  now: () => Date;
}

interface Tool<S extends z.ZodType> {
  name: string;
  description: string;
  schema: S;
  writes: boolean;
  run(t: ToolRunContext, db: Db, ctx: UserCtx, args: z.infer<S>): Promise<ToolOutput>;
}
type ToolOutput = Record<string, unknown> & { outcome: string; entityId?: string | null };
const defineTool = <S extends z.ZodType>(t: Tool<S>): Tool<S> => t;

const PENDING_TTL_MS = 10 * 60 * 1000;
const MEMORY_WEIGHT_RE = /\d+(?:[.,]\d+)?\s*(?:кг|kg|lb|lbs|фунт|килограм)/i;

/* ---------------------------------------------------------------- argument schemas */

const DateArg = z.string().refine(isValidLocalDate, 'Expected YYYY-MM-DD');
const TimeArg = z.string().regex(/^([01]\d|2[0-3]):[0-5]\d$/, 'Expected HH:MM (24h)');
const WeightArg = z.number().positive().max(1000);
const UnitArg = z.enum(['kg', 'lb']);

/* ---------------------------------------------------------------- helpers */

/** Number formatting in the user's unit and language, so the model can quote strings verbatim. */
type Fmt = Pick<UserCtx, 'unit' | 'language'>;
const UNIT_WORD = {
  ru: { kg: 'кг', lb: 'фунт.' },
  en: { kg: 'kg', lb: 'lb' },
  hy: { kg: 'կգ', lb: 'ֆունտ' },
} as const;
const WEEK_WORD = { ru: 'нед', en: 'week', hy: 'շաբ' } as const;
function localize(core: string, f: Fmt): string {
  const [n, u] = core.split(' ') as [string, WeightUnit];
  return `${f.language === 'en' ? n : n.replace('.', ',')} ${UNIT_WORD[f.language][u]}`;
}
const fmt = (g: number, f: Fmt) => localize(formatWeight(g, f.unit), f);
const fmtD = (g: number, f: Fmt) => localize(formatDelta(Math.round(g), f.unit), f);
const perWeek = (gPerDay: number, f: Fmt) => `${fmtD(gPerDay * 7, f)}/${WEEK_WORD[f.language]}`;

function grams(weight: number, unit: WeightUnit | undefined, ctx: UserCtx): number {
  const g = toGrams(weight, unit ?? ctx.unit);
  if (!isValidWeightG(g)) {
    throw new ApiError(
      400,
      'VALIDATION_ERROR',
      `Weight ${weight} ${unit ?? ctx.unit} is outside the allowed range 20–400 kg. Ask the user to check the value.`,
    );
  }
  return g;
}

/** Deterministic id so a retried chat message cannot create the same entry twice. */
function stableUuid(...parts: string[]): string {
  const h = createHash('sha256').update(parts.join('|')).digest('hex');
  return `${h.slice(0, 8)}-${h.slice(8, 12)}-4${h.slice(13, 16)}-${((parseInt(h[16]!, 16) & 0x3) | 0x8).toString(16)}${h.slice(17, 20)}-${h.slice(20, 32)}`;
}

function describeSummary(s: Summary, u: Fmt) {
  const a = s.averages;
  return {
    asOf: s.asOf,
    measuredDays: s.measuredDays,
    latest: s.latest
      ? {
          date: s.latest.date,
          display: fmt(s.latest.weightG, u),
          entriesThatDay: s.latest.entryCount,
        }
      : null,
    changeSincePrevious:
      s.changeSincePrevious && s.previous
        ? {
            display: fmtD(s.changeSincePrevious.deltaG, u),
            previousDate: s.previous.date,
            days: s.changeSincePrevious.days,
          }
        : null,
    changeFromBaseline:
      s.changeFromBaseline && s.baseline
        ? {
            display: fmtD(s.changeFromBaseline.deltaG, u),
            since: s.baseline.date,
            baselineSource: s.baseline.source,
            days: s.changeFromBaseline.days,
            ratePerWeek:
              s.changeFromBaseline.ratePerWeekG !== null
                ? `${fmtD(s.changeFromBaseline.ratePerWeekG, u)}/${WEEK_WORD[u.language]}`
                : null,
          }
        : null,
    average7Days: {
      display: a.last7.avgG !== null ? fmt(Math.round(a.last7.avgG), u) : null,
      measurements: a.last7.count,
      from: a.last7.from,
      to: a.last7.to,
    },
    averagePrevious7Days: {
      display: a.prev7.avgG !== null ? fmt(Math.round(a.prev7.avgG), u) : null,
      measurements: a.prev7.count,
    },
    weekOverWeek:
      a.last7.avgG !== null && a.prev7.avgG !== null ? fmtD(a.last7.avgG - a.prev7.avgG, u) : null,
    average30Days: {
      display: a.last30.avgG !== null ? fmt(Math.round(a.last30.avgG), u) : null,
      measurements: a.last30.count,
    },
    pace: {
      classification: s.pace.classification,
      recent14Days: s.pace.recent ? perWeek(s.pace.recent.slopeGPerDay, u) : null,
      previous14Days: s.pace.previous ? perWeek(s.pace.previous.slopeGPerDay, u) : null,
    },
    goal: s.goal
      ? {
          direction: s.goal.direction,
          status: s.goal.status,
          start: fmt(s.goal.startWeightG, u),
          target: fmt(s.goal.targetWeightG, u),
          startDate: s.goal.startDate,
          remaining: s.goal.remainingG !== null ? fmt(Math.abs(s.goal.remainingG), u) : null,
          progressPercent: s.goal.progressPct !== null ? Math.round(s.goal.progressPct) : null,
        }
      : null,
    forecast: {
      status: s.forecast.status,
      reason: s.forecast.reason,
      etaDate: s.forecast.etaDate,
      etaDays: s.forecast.etaDays,
      interval80: s.forecast.range
        ? {
            earliest: s.forecast.range.earliest,
            latest: s.forecast.range.latest ?? 'more than 2 years',
          }
        : null,
      trend: s.forecast.trend ? perWeek(s.forecast.trend.slopeGPerDay, u) : null,
    },
  };
}

/* ---------------------------------------------------------------- tools */

const getUserProfile = defineTool({
  name: 'get_user_profile',
  description:
    "Returns the user's display name, time zone, today's date, weight unit and report/tone preferences.",
  schema: z.object({}).strict(),
  writes: false,
  async run(_t, db, ctx) {
    const me = await getMe(db, ctx.userId);
    return {
      outcome: 'ok',
      displayName: me.displayName,
      timezone: me.timezone,
      today: ctx.today,
      unit: me.weightUnit,
      preferences: me.preferences,
    };
  },
});

const getWeightHistory = defineTool({
  name: 'get_weight_history',
  description:
    'Lists raw weight entries (newest first) with id, date, local time, weight and whether it is the morning value used in analytics. Use the ids for update/delete.',
  schema: z
    .object({
      from: DateArg.optional().describe('Start date YYYY-MM-DD (inclusive)'),
      to: DateArg.optional().describe('End date YYYY-MM-DD (inclusive)'),
      limit: z.number().int().min(1).max(200).optional().describe('Max entries, default 30'),
    })
    .strict(),
  writes: false,
  async run(_t, db, ctx, a) {
    const [page, entries] = await Promise.all([
      listWeights(db, { from: a.from, to: a.to, limit: a.limit ?? 30 }),
      loadEntries(db),
    ]);
    const morning = new Set(toDailySeries(entries, ctx.today).map((p) => p.entryId));
    return {
      outcome: 'ok',
      count: page.items.length,
      more: page.nextCursor !== null,
      entries: page.items.map((e) => ({
        id: e.id,
        date: e.measuredOn,
        time: e.measuredAt ? localTimeInTimeZone(e.measuredAt, ctx.timezone) : null,
        weight: fmt(e.weightG, ctx),
        morningValue: morning.has(e.id),
        note: e.note,
        source: e.source,
      })),
    };
  },
});

const calculateAnalytics = defineTool({
  name: 'calculate_weight_analytics',
  description:
    'Computes all statistics from the diary: latest morning weight, changes, 7/30-day averages with counts, 14-day pace, goal progress and goal forecast with an 80% interval.',
  schema: z.object({}).strict(),
  writes: false,
  async run(_t, db, ctx) {
    return {
      outcome: 'ok',
      unit: ctx.unit,
      today: ctx.today,
      ...describeSummary(await getSummary(db, ctx), ctx),
    };
  },
});

const addWeightEntry = defineTool({
  name: 'add_weight_entry',
  description:
    "Records the user's weight measurement. Call only for a clearly reported own measurement. Date defaults to today in the user's time zone.",
  schema: z
    .object({
      weight: WeightArg.describe('Numeric value as the user said it'),
      unit: UnitArg.optional().describe("Unit of `weight`; defaults to the user's unit"),
      date: DateArg.optional().describe('YYYY-MM-DD in the user time zone; default today'),
      time: TimeArg.optional().describe('Local HH:MM if the user said when'),
      note: z.string().max(500).optional(),
      allow_duplicate: z
        .boolean()
        .optional()
        .describe('Set only if the user confirmed recording the same value twice for the date'),
    })
    .strict(),
  writes: true,
  async run(t, db, ctx, a) {
    const weightG = grams(a.weight, a.unit, ctx);
    const date = a.date ?? ctx.today;
    // "Today" without a time means "just now", so it orders correctly against other entries today.
    const measuredAt = a.time
      ? zonedTimeToUtc(date, a.time, ctx.timezone).toISOString()
      : date === ctx.today
        ? t.now().toISOString()
        : undefined;
    const { entry, created } = await createWeight(
      db,
      ctx,
      {
        weightG,
        measuredOn: date,
        measuredAt,
        note: a.note,
        allowDuplicate: a.allow_duplicate,
        clientEntryId: stableUuid(t.userMessageId, String(weightG), date, a.time ?? ''),
      },
      'chat',
    );
    const series = toDailySeries(await loadEntries(db), ctx.today);
    const idx = series.findIndex((p) => p.date === entry.measuredOn);
    const day = series[idx];
    const isMorning = day?.entryId === entry.id;
    const prev = idx > 0 ? series[idx - 1] : undefined;
    const avg7 = windowAverage(series, ctx.today, 7);
    return {
      outcome: created ? 'created' : 'already_recorded',
      entityId: entry.id,
      entry: {
        id: entry.id,
        date: entry.measuredOn,
        time: entry.measuredAt ? localTimeInTimeZone(entry.measuredAt, ctx.timezone) : null,
        weight: fmt(entry.weightG, ctx),
      },
      isMorningValueForDay: isMorning,
      morningValueForDay: day && !isMorning ? fmt(day.weightG, ctx) : null,
      changeSincePreviousMorning:
        isMorning && prev
          ? { display: fmtD(entry.weightG - prev.weightG, ctx), previousDate: prev.date }
          : null,
      average7Days:
        avg7.avgG !== null
          ? { display: fmt(Math.round(avg7.avgG), ctx), measurements: avg7.count }
          : null,
    };
  },
});

const updateWeightEntry = defineTool({
  name: 'update_weight_entry',
  description:
    'Corrects an existing entry (value, date, time or note). Get the entry id from get_weight_history first.',
  schema: z
    .object({
      entry_id: z.uuid(),
      weight: WeightArg.optional(),
      unit: UnitArg.optional(),
      date: DateArg.optional(),
      time: TimeArg.optional(),
      note: z.string().max(500).optional(),
    })
    .strict(),
  writes: true,
  async run(_t, db, ctx, a) {
    const before = await getWeight(db, a.entry_id);
    const date = a.date ?? before.measuredOn;
    const e = await updateWeight(db, ctx, a.entry_id, {
      ...(a.weight !== undefined ? { weightG: grams(a.weight, a.unit, ctx) } : {}),
      ...(a.date !== undefined ? { measuredOn: a.date } : {}),
      ...(a.time !== undefined
        ? { measuredAt: zonedTimeToUtc(date, a.time, ctx.timezone).toISOString() }
        : {}),
      ...(a.note !== undefined ? { note: a.note } : {}),
    });
    return {
      outcome: 'updated',
      entityId: e.id,
      before: { date: before.measuredOn, weight: fmt(before.weightG, ctx) },
      after: {
        date: e.measuredOn,
        time: e.measuredAt ? localTimeInTimeZone(e.measuredAt, ctx.timezone) : null,
        weight: fmt(e.weightG, ctx),
        note: e.note,
      },
    };
  },
});

const deleteWeightEntry = defineTool({
  name: 'delete_weight_entry',
  description:
    'Deletes one entry in two steps. Without confirmation_id it only prepares the deletion and returns a confirmation_id; show the user what will be deleted and wait. Call again with that confirmation_id only after the user confirms in a new message.',
  schema: z.object({ entry_id: z.uuid(), confirmation_id: z.uuid().optional() }).strict(),
  writes: true,
  async run(t, db, ctx, a) {
    const entry = await getWeight(db, a.entry_id);
    const p = t.pending;
    if (a.confirmation_id) {
      const valid =
        p &&
        p.confirmationId === a.confirmation_id &&
        p.entryId === a.entry_id &&
        new Date(p.expiresAt).getTime() > t.now().getTime() &&
        p.createdInMessageId !== t.userMessageId;
      if (!valid) {
        return {
          outcome: 'confirmation_invalid',
          ok: false,
          error:
            'Confirmation is missing, expired, for another entry, or was not given in a later user message. Prepare the deletion again and ask the user.',
        };
      }
      await deleteWeight(db, a.entry_id);
      await setPendingAction(db, t.conversationId, null);
      t.pending = null;
      return {
        outcome: 'deleted',
        entityId: entry.id,
        deleted: { date: entry.measuredOn, weight: fmt(entry.weightG, ctx) },
      };
    }
    const time = entry.measuredAt ? ` ${localTimeInTimeZone(entry.measuredAt, ctx.timezone)}` : '';
    const pending: PendingAction = {
      type: 'delete_weight_entry',
      confirmationId: randomUUID(),
      entryId: entry.id,
      description: `${entry.measuredOn}${time} — ${fmt(entry.weightG, ctx)}`,
      expiresAt: new Date(t.now().getTime() + PENDING_TTL_MS).toISOString(),
      createdInMessageId: t.userMessageId,
    };
    await setPendingAction(db, t.conversationId, pending);
    t.pending = pending;
    return {
      outcome: 'confirmation_required',
      entityId: entry.id,
      confirmation_id: pending.confirmationId,
      willDelete: pending.description,
      expiresInMinutes: PENDING_TTL_MS / 60000,
      instruction: 'Ask the user to confirm. Do not call delete again in this turn.',
    };
  },
});

const manageGoal = defineTool({
  name: 'manage_goal',
  description:
    "Sets a new weight goal (replacing the active one) or clears it. Only on the user's explicit request. Start weight defaults to the latest morning weight, start date to today.",
  schema: z
    .object({
      action: z.enum(['set', 'clear']),
      target_weight: WeightArg.optional(),
      unit: UnitArg.optional(),
      start_weight: WeightArg.optional(),
      start_date: DateArg.optional(),
    })
    .strict(),
  writes: true,
  async run(_t, db, ctx, a) {
    if (a.action === 'clear') {
      const g = await clearGoal(db);
      return { outcome: 'cleared', entityId: g.id };
    }
    if (a.target_weight === undefined)
      throw new ApiError(400, 'VALIDATION_ERROR', 'target_weight is required for action=set');
    const previous = await activeGoal(db);
    const g = await setGoal(db, ctx, {
      targetWeightG: grams(a.target_weight, a.unit, ctx),
      ...(a.start_weight !== undefined ? { startWeightG: grams(a.start_weight, a.unit, ctx) } : {}),
      ...(a.start_date ? { startDate: a.start_date } : {}),
    });
    const s = await getSummary(db, ctx);
    return {
      outcome: 'goal_set',
      entityId: g.id,
      goal: {
        direction: g.direction,
        start: fmt(g.startWeightG, ctx),
        target: fmt(g.targetWeightG, ctx),
        startDate: g.startDate,
      },
      replacedPrevious: previous ? { target: fmt(previous.targetWeightG, ctx) } : null,
      forecast: describeSummary(s, ctx).forecast,
    };
  },
});

const getAgentMemory = defineTool({
  name: 'get_agent_memory',
  description: 'Lists what the user asked you to remember (preferences, rules, facts) with ids.',
  schema: z.object({}).strict(),
  writes: false,
  async run(_t, db) {
    const items = await listMemory(db);
    return {
      outcome: 'ok',
      items: items.map((m) => ({ id: m.id, kind: m.kind, content: m.content })),
    };
  },
});

const updateAgentMemory = defineTool({
  name: 'update_agent_memory',
  description:
    'Adds, edits or deletes a long-term memory item. Never store weights, goals or health details here — those live in the diary or are not kept.',
  schema: z
    .object({
      action: z.enum(['add', 'update', 'delete']),
      memory_id: z.uuid().optional(),
      kind: z.enum(['preference', 'rule', 'fact']).optional(),
      content: z.string().trim().min(1).max(500).optional(),
    })
    .strict(),
  writes: true,
  async run(_t, db, ctx, a) {
    const me = await getMe(db, ctx.userId);
    if (!me.preferences.memoryEnabled && a.action !== 'delete') {
      return {
        outcome: 'memory_disabled',
        ok: false,
        error: 'The user turned memory off in settings. Tell them it can be enabled there.',
      };
    }
    if (a.content && MEMORY_WEIGHT_RE.test(a.content)) {
      return {
        outcome: 'rejected_weight_in_memory',
        ok: false,
        error:
          'Weights and goals are not stored in memory. Use add_weight_entry or manage_goal if that is what the user wants.',
      };
    }
    if (a.action === 'add') {
      if (!a.content) throw new ApiError(400, 'VALIDATION_ERROR', 'content is required for add');
      const m = await addMemory(db, ctx.userId, a.kind ?? 'fact', a.content, 'agent');
      return {
        outcome: 'added',
        entityId: m.id,
        item: { id: m.id, kind: m.kind, content: m.content },
      };
    }
    if (!a.memory_id)
      throw new ApiError(
        400,
        'VALIDATION_ERROR',
        'memory_id is required; call get_agent_memory first',
      );
    if (a.action === 'delete') {
      await deleteMemory(db, a.memory_id);
      return { outcome: 'deleted', entityId: a.memory_id };
    }
    const m = await updateMemory(db, a.memory_id, { kind: a.kind, content: a.content });
    return {
      outcome: 'updated',
      entityId: m.id,
      item: { id: m.id, kind: m.kind, content: m.content },
    };
  },
});

const generateReport = defineTool({
  name: 'generate_report',
  description:
    "Builds a progress report for a period (default: last 7 days) with the period's averages, range, change, trend, comparison with the previous period of equal length, goal status and forecast. Format the answer per the user's report_format.",
  schema: z
    .object({
      period: z.enum(['week', 'month', 'custom']).default('week'),
      from: DateArg.optional().describe('For custom'),
      to: DateArg.optional().describe('For custom; default today'),
    })
    .strict(),
  writes: false,
  async run(_t, db, ctx, a) {
    const to: LocalDate = a.period === 'custom' && a.to ? a.to : ctx.today;
    const from: LocalDate =
      a.period === 'custom'
        ? (a.from ?? addDays(to, -6))
        : addDays(to, a.period === 'month' ? -29 : -6);
    if (from > to) throw new ApiError(400, 'VALIDATION_ERROR', '`from` is after `to`');
    const length = daysBetween(from, to) + 1;
    const all = toDailySeries(await loadEntries(db), ctx.today);
    const inP = all.filter((p) => p.date >= from && p.date <= to);
    const prevTo = addDays(from, -1);
    const prevFrom = addDays(prevTo, -(length - 1));
    const inPrev = all.filter((p) => p.date >= prevFrom && p.date <= prevTo);
    const avg = (ps: typeof all) =>
      ps.length ? ps.reduce((s, p) => s + p.weightG, 0) / ps.length : null;
    const a1 = avg(inP);
    const a0 = avg(inPrev);
    const trend = inP.length >= 3 ? linearTrend(inP) : null;
    const s = describeSummary(await getSummary(db, ctx), ctx);
    const me = await getMe(db, ctx.userId);
    const first = inP[0];
    const last = inP[inP.length - 1];
    return {
      outcome: 'ok',
      reportFormat: me.preferences.reportFormat,
      period: { from, to, calendarDays: length, measuredDays: inP.length },
      average: a1 !== null ? fmt(Math.round(a1), ctx) : null,
      previousPeriod: {
        from: prevFrom,
        to: prevTo,
        average: a0 !== null ? fmt(Math.round(a0), ctx) : null,
        measuredDays: inPrev.length,
      },
      changeOfAverage: a1 !== null && a0 !== null ? fmtD(a1 - a0, ctx) : null,
      min: inP.length ? fmt(Math.min(...inP.map((p) => p.weightG)), ctx) : null,
      max: inP.length ? fmt(Math.max(...inP.map((p) => p.weightG)), ctx) : null,
      firstToLast:
        first && last && first !== last
          ? {
              from: first.date,
              to: last.date,
              change: fmtD(last.weightG - first.weightG, ctx),
            }
          : null,
      trend: trend ? perWeek(trend.slopeGPerDay, ctx) : null,
      goal: s.goal,
      forecast: s.forecast,
    };
  },
});

// eslint-disable-next-line @typescript-eslint/no-explicit-any
export const TOOLS: Tool<any>[] = [
  getUserProfile,
  getWeightHistory,
  calculateAnalytics,
  addWeightEntry,
  updateWeightEntry,
  deleteWeightEntry,
  manageGoal,
  getAgentMemory,
  updateAgentMemory,
  generateReport,
];
export const TOOL_NAMES = TOOLS.map((t) => t.name);

export function toolDefinitions(allowed: readonly string[]): ToolDefinition[] {
  return TOOLS.filter((t) => allowed.includes(t.name)).map((t) => {
    const { $schema: _ignored, ...parameters } = z.toJSONSchema(t.schema, {
      io: 'input',
    }) as Record<string, unknown>;
    return {
      type: 'function',
      name: t.name,
      description: t.description,
      parameters,
      strict: false,
    };
  });
}

export interface ToolCallResult {
  output: string;
  event: ToolEvent;
}

/** Validates and executes one model function call. Never throws: failures go back to the model. */
export async function executeTool(
  t: ToolRunContext,
  allowed: readonly string[],
  name: string,
  rawArgs: string,
): Promise<ToolCallResult> {
  const tool = TOOLS.find((x) => x.name === name);
  const fail = (code: string, message: string, details?: unknown): ToolCallResult => ({
    output: JSON.stringify({ ok: false, error: { code, message, details } }),
    event: { name, ok: false, outcome: code, entityId: null },
  });
  if (!tool || !allowed.includes(name))
    return fail('UNKNOWN_TOOL', `Tool ${name} is not available`);
  let json: unknown;
  try {
    json = rawArgs.trim() ? JSON.parse(rawArgs) : {};
  } catch {
    return fail('VALIDATION_ERROR', 'Arguments are not valid JSON');
  }
  const parsed = tool.schema.safeParse(json);
  if (!parsed.success) {
    return fail(
      'VALIDATION_ERROR',
      'Invalid arguments',
      parsed.error.issues.map((i: z.core.$ZodIssue) => ({
        path: i.path.join('.'),
        message: i.message,
      })),
    );
  }
  try {
    const out = await withUser(t.pool, t.userId, async (db) => {
      const ctx = await loadCtx(db, t.userId, t.now());
      return tool.run(t, db, ctx, parsed.data);
    });
    const ok = out.ok !== false;
    return {
      output: JSON.stringify({ ok, ...out }),
      event: { name, ok, outcome: out.outcome, entityId: out.entityId ?? null },
    };
  } catch (e) {
    const err = toApiError(e);
    return fail(
      err.code,
      err.status >= 500 ? 'Internal error while running the tool' : err.message,
      err.details,
    );
  }
}
