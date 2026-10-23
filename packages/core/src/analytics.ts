import { addDays, assertLocalDate, daysBetween, toEpochDay, type LocalDate } from './dates.js';
import { assertWeightG } from './units.js';

/* ------------------------------------------------------------------ types */

export interface WeightEntryInput {
  id?: string;
  /** Calendar date in the user's time zone. */
  measuredOn: LocalDate;
  /** Optional exact instant (ISO 8601). Used only to pick the morning value of a day. */
  measuredAt?: string | null;
  weightG: number;
}

export interface GoalInput {
  startWeightG: number;
  targetWeightG: number;
  startDate: LocalDate;
}

export type GoalDirection = 'lose' | 'gain' | 'maintain';

export interface DailyPoint {
  date: LocalDate;
  weightG: number;
  /** How many raw entries existed on this day (only the first one is used). */
  entryCount: number;
  entryId?: string;
}

export interface WindowAverage {
  from: LocalDate;
  to: LocalDate;
  calendarDays: number;
  /** Number of measured days inside the window. Missing days are never filled in. */
  count: number;
  avgG: number | null;
}

export interface Trend {
  from: LocalDate;
  to: LocalDate;
  points: number;
  slopeGPerDay: number;
  slopeGPerWeek: number;
  /** Standard error of the slope (null when fewer than 3 points). */
  stdErrorGPerDay: number | null;
  /** Fitted weight at `to`. */
  fittedAtEndG: number;
}

export type PaceClassification =
  | 'insufficient_data'
  | 'accelerating'
  | 'slowing'
  | 'stable'
  | 'reversed';

export interface PaceAnalysis {
  recent: Trend | null;
  previous: Trend | null;
  classification: PaceClassification;
  /** recent − previous, in |g/day| (positive = faster). */
  changeGPerDay: number | null;
}

export type GoalStatus =
  | 'in_progress'
  | 'achieved'
  | 'exceeded'
  | 'within_range'
  | 'outside_range'
  | 'no_data';

export interface GoalProgress {
  direction: GoalDirection;
  startWeightG: number;
  targetWeightG: number;
  startDate: LocalDate;
  currentWeightG: number | null;
  /** current − start (negative = weight went down). */
  doneG: number | null;
  /** target − current (signed). */
  remainingG: number | null;
  /** 0..100 nominally; may be <0 (moved away) or >100 (past target). Null for maintain. */
  progressPct: number | null;
  status: GoalStatus;
}

export type ForecastStatus =
  | 'no_goal'
  | 'maintain_goal'
  | 'achieved'
  | 'insufficient_data'
  | 'no_trend'
  | 'moving_away'
  | 'too_far'
  | 'ok';

export interface Forecast {
  status: ForecastStatus;
  /** Human-oriented reason code details, for UI/agent. */
  reason: string;
  trend: Trend | null;
  etaDate: LocalDate | null;
  etaDays: number | null;
  /** 80 % interval for the arrival date; `latest` is null when the slow bound never arrives. */
  range: { earliest: LocalDate; latest: LocalDate | null; confidence: number } | null;
}

export interface Summary {
  asOf: LocalDate;
  entryCount: number;
  measuredDays: number;
  first: DailyPoint | null;
  latest: DailyPoint | null;
  previous: DailyPoint | null;
  changeSincePrevious: { deltaG: number; days: number } | null;
  baseline: { weightG: number; date: LocalDate; source: 'goal' | 'first_entry' } | null;
  changeFromBaseline: {
    deltaG: number;
    days: number;
    ratePerDayG: number | null;
    ratePerWeekG: number | null;
  } | null;
  averages: { last7: WindowAverage; prev7: WindowAverage; last30: WindowAverage };
  goal: GoalProgress | null;
  pace: PaceAnalysis;
  forecast: Forecast;
}

/* -------------------------------------------------------------- constants */

export const ANALYTICS_RULES = {
  /** |current − target| at or below this counts as "achieved". */
  goalToleranceG: 100,
  /** Band around the target for maintenance goals. */
  maintainBandG: 1000,
  paceWindowDays: 14,
  paceMinPoints: 3,
  paceMinSpanDays: 5,
  /** Slope differences below this (g/day) are "stable". */
  paceStableThresholdGPerDay: 10,
  forecastWindowDays: 28,
  forecastMinPoints: 5,
  forecastMinSpanDays: 10,
  /** Below this |slope| there is no usable trend. */
  forecastMinSlopeGPerDay: 5,
  forecastMaxDays: 730,
  forecastConfidence: 0.8,
} as const;

/* ---------------------------------------------------------------- helpers */

function compareEntries(a: WeightEntryInput, b: WeightEntryInput): number {
  if (a.measuredOn !== b.measuredOn) return a.measuredOn < b.measuredOn ? -1 : 1;
  const ta = a.measuredAt ? Date.parse(a.measuredAt) : Number.POSITIVE_INFINITY;
  const tb = b.measuredAt ? Date.parse(b.measuredAt) : Number.POSITIVE_INFINITY;
  if (ta !== tb) return ta - tb;
  return (a.id ?? '').localeCompare(b.id ?? '');
}

/**
 * Collapses raw entries into one value per calendar day: the earliest measurement of the
 * day (the "morning weigh-in"). Entries after `asOf` are ignored. Never invents days.
 */
export function toDailySeries(entries: WeightEntryInput[], asOf?: LocalDate): DailyPoint[] {
  const valid = entries.filter((e) => {
    assertLocalDate(e.measuredOn);
    assertWeightG(e.weightG);
    return asOf === undefined || e.measuredOn <= asOf;
  });
  const sorted = [...valid].sort(compareEntries);
  const out: DailyPoint[] = [];
  for (const e of sorted) {
    const last = out[out.length - 1];
    if (last && last.date === e.measuredOn) {
      last.entryCount += 1;
      continue;
    }
    const p: DailyPoint = { date: e.measuredOn, weightG: e.weightG, entryCount: 1 };
    if (e.id !== undefined) p.entryId = e.id;
    out.push(p);
  }
  return out;
}

/** Average over a closed range of calendar days [to − days + 1, to]. */
export function windowAverage(series: DailyPoint[], to: LocalDate, days: number): WindowAverage {
  const from = addDays(to, -(days - 1));
  const inWin = series.filter((p) => p.date >= from && p.date <= to);
  const avgG = inWin.length
    ? Math.round(inWin.reduce((s, p) => s + p.weightG, 0) / inWin.length)
    : null;
  return { from, to, calendarDays: days, count: inWin.length, avgG };
}

/** Ordinary least squares on (calendar day, weight). Needs ≥2 points on ≥2 distinct days. */
export function linearTrend(points: DailyPoint[]): Trend | null {
  if (points.length < 2) return null;
  const first = points[0]!;
  const last = points[points.length - 1]!;
  const x0 = toEpochDay(first.date);
  const xs = points.map((p) => toEpochDay(p.date) - x0);
  const ys = points.map((p) => p.weightG);
  const n = points.length;
  const mx = xs.reduce((a, b) => a + b, 0) / n;
  const my = ys.reduce((a, b) => a + b, 0) / n;
  let sxx = 0;
  let sxy = 0;
  for (let i = 0; i < n; i++) {
    sxx += (xs[i]! - mx) ** 2;
    sxy += (xs[i]! - mx) * (ys[i]! - my);
  }
  if (sxx === 0) return null;
  const slope = sxy / sxx;
  const intercept = my - slope * mx;
  let se: number | null = null;
  if (n >= 3) {
    let ssr = 0;
    for (let i = 0; i < n; i++) ssr += (ys[i]! - (intercept + slope * xs[i]!)) ** 2;
    se = Math.sqrt(ssr / (n - 2) / sxx);
  }
  const xEnd = toEpochDay(last.date) - x0;
  return {
    from: first.date,
    to: last.date,
    points: n,
    slopeGPerDay: slope,
    slopeGPerWeek: slope * 7,
    stdErrorGPerDay: se,
    fittedAtEndG: intercept + slope * xEnd,
  };
}

/** Two-sided 80 % Student-t quantile (one-sided 90 %) by degrees of freedom. */
function t80(df: number): number {
  const table: Array<[number, number]> = [
    [1, 3.078], [2, 1.886], [3, 1.638], [4, 1.533], [5, 1.476], [6, 1.44], [7, 1.415],
    [8, 1.397], [9, 1.383], [10, 1.372], [12, 1.356], [15, 1.341], [20, 1.325],
    [25, 1.316], [30, 1.31],
  ];
  if (df > 30) return 1.2816;
  let v = table[0]![1];
  for (const [d, q] of table) if (df >= d) v = q;
  return v;
}

export function goalDirection(goal: GoalInput): GoalDirection {
  const diff = goal.targetWeightG - goal.startWeightG;
  if (Math.abs(diff) <= ANALYTICS_RULES.goalToleranceG) return 'maintain';
  return diff < 0 ? 'lose' : 'gain';
}

function dirSign(direction: GoalDirection): number {
  return direction === 'lose' ? -1 : direction === 'gain' ? 1 : 0;
}

export function goalProgress(goal: GoalInput, currentWeightG: number | null): GoalProgress {
  assertWeightG(goal.startWeightG);
  assertWeightG(goal.targetWeightG);
  assertLocalDate(goal.startDate);
  const direction = goalDirection(goal);
  const base = {
    direction,
    startWeightG: goal.startWeightG,
    targetWeightG: goal.targetWeightG,
    startDate: goal.startDate,
  };
  if (currentWeightG === null) {
    return { ...base, currentWeightG: null, doneG: null, remainingG: null, progressPct: null, status: 'no_data' };
  }
  const doneG = currentWeightG - goal.startWeightG;
  const remainingG = goal.targetWeightG - currentWeightG;
  if (direction === 'maintain') {
    return {
      ...base,
      currentWeightG,
      doneG,
      remainingG,
      progressPct: null,
      status: Math.abs(remainingG) <= ANALYTICS_RULES.maintainBandG ? 'within_range' : 'outside_range',
    };
  }
  const total = goal.targetWeightG - goal.startWeightG;
  const progressPct = Math.round((doneG / total) * 1000) / 10;
  const s = dirSign(direction);
  // Directional distance still to go: >0 means not yet reached.
  const toGo = remainingG * s;
  let status: GoalStatus;
  if (Math.abs(remainingG) <= ANALYTICS_RULES.goalToleranceG) status = 'achieved';
  else if (toGo < 0) status = 'exceeded';
  else status = 'in_progress';
  return { ...base, currentWeightG, doneG, remainingG, progressPct, status };
}

export function analysePace(series: DailyPoint[], asOf: LocalDate): PaceAnalysis {
  const R = ANALYTICS_RULES;
  const pick = (endOffset: number) => {
    const to = addDays(asOf, -endOffset);
    const from = addDays(to, -(R.paceWindowDays - 1));
    const pts = series.filter((p) => p.date >= from && p.date <= to);
    if (pts.length < R.paceMinPoints) return null;
    if (daysBetween(pts[0]!.date, pts[pts.length - 1]!.date) < R.paceMinSpanDays) return null;
    return linearTrend(pts);
  };
  const recent = pick(0);
  const previous = pick(R.paceWindowDays);
  if (!recent || !previous) {
    return { recent, previous, classification: 'insufficient_data', changeGPerDay: null };
  }
  const a = recent.slopeGPerDay;
  const b = previous.slopeGPerDay;
  const th = R.paceStableThresholdGPerDay;
  const change = Math.abs(a) - Math.abs(b);
  let classification: PaceClassification;
  if (Math.sign(a) !== Math.sign(b) && Math.abs(a) > th && Math.abs(b) > th) classification = 'reversed';
  else if (change > th) classification = 'accelerating';
  else if (change < -th) classification = 'slowing';
  else classification = 'stable';
  return { recent, previous, classification, changeGPerDay: change };
}

export function forecastGoal(
  series: DailyPoint[],
  goal: GoalInput | null,
  asOf: LocalDate,
): Forecast {
  const R = ANALYTICS_RULES;
  const empty = (status: ForecastStatus, reason: string, trend: Trend | null = null): Forecast => ({
    status,
    reason,
    trend,
    etaDate: null,
    etaDays: null,
    range: null,
  });
  if (!goal) return empty('no_goal', 'No active goal.');
  const direction = goalDirection(goal);
  if (direction === 'maintain') return empty('maintain_goal', 'Maintenance goals have no arrival date.');
  const latest = series[series.length - 1];
  if (latest) {
    const st = goalProgress(goal, latest.weightG).status;
    if (st === 'achieved' || st === 'exceeded') return empty('achieved', 'Latest measurement has reached the target.');
  }
  const from = addDays(asOf, -(R.forecastWindowDays - 1));
  const pts = series.filter((p) => p.date >= from && p.date <= asOf);
  if (pts.length < R.forecastMinPoints) {
    return empty('insufficient_data', `Need at least ${R.forecastMinPoints} measured days in the last ${R.forecastWindowDays} days (have ${pts.length}).`);
  }
  const span = daysBetween(pts[0]!.date, pts[pts.length - 1]!.date);
  if (span < R.forecastMinSpanDays) {
    return empty('insufficient_data', `Measurements must span at least ${R.forecastMinSpanDays} days (span ${span}).`);
  }
  const trend = linearTrend(pts);
  if (!trend) return empty('insufficient_data', 'Trend cannot be computed.');
  const s = dirSign(direction);
  const slope = trend.slopeGPerDay;
  if (Math.abs(slope) < R.forecastMinSlopeGPerDay) {
    return empty('no_trend', 'Weight is roughly flat; no reliable trend.', trend);
  }
  if (slope * s < 0) return empty('moving_away', 'Recent trend points away from the target.', trend);

  // Start from the fitted value at today (less noisy than a single reading).
  const fittedToday = trend.fittedAtEndG + slope * daysBetween(trend.to, asOf);
  let remaining = goal.targetWeightG - fittedToday;
  if (remaining * s <= 0) remaining = goal.targetWeightG - latest!.weightG;
  const etaDays = Math.ceil(remaining / slope);
  if (etaDays > R.forecastMaxDays) {
    return empty('too_far', `At the current pace the target is more than ${R.forecastMaxDays} days away.`, trend);
  }
  let range: Forecast['range'] = null;
  if (trend.stdErrorGPerDay !== null) {
    const margin = t80(trend.points - 2) * trend.stdErrorGPerDay;
    const fast = Math.abs(slope) + margin;
    const slow = Math.abs(slope) - margin;
    const absRem = Math.abs(remaining);
    const earliestDays = Math.ceil(absRem / fast);
    const latestDays = slow > 0 ? Math.ceil(absRem / slow) : null;
    range = {
      earliest: addDays(asOf, Math.max(earliestDays, 0)),
      latest: latestDays !== null && latestDays <= R.forecastMaxDays ? addDays(asOf, latestDays) : null,
      confidence: R.forecastConfidence,
    };
  }
  return {
    status: 'ok',
    reason: 'Linear trend of recent measured days.',
    trend,
    etaDays: Math.max(etaDays, 0),
    etaDate: addDays(asOf, Math.max(etaDays, 0)),
    range,
  };
}

/** One-call summary used by the API, the agent tools and both clients. */
export function computeSummary(
  entries: WeightEntryInput[],
  goal: GoalInput | null,
  asOf: LocalDate,
): Summary {
  assertLocalDate(asOf);
  const series = toDailySeries(entries, asOf);
  const entryCount = entries.filter((e) => e.measuredOn <= asOf).length;
  const first = series[0] ?? null;
  const latest = series[series.length - 1] ?? null;
  const previous = series.length >= 2 ? series[series.length - 2]! : null;

  let baseline: Summary['baseline'] = null;
  if (goal) baseline = { weightG: goal.startWeightG, date: goal.startDate, source: 'goal' };
  else if (first) baseline = { weightG: first.weightG, date: first.date, source: 'first_entry' };

  let changeFromBaseline: Summary['changeFromBaseline'] = null;
  if (baseline && latest) {
    const days = daysBetween(baseline.date, latest.date);
    const deltaG = latest.weightG - baseline.weightG;
    const ratePerDayG = days > 0 ? deltaG / days : null;
    changeFromBaseline = {
      deltaG,
      days,
      ratePerDayG: ratePerDayG === null ? null : Math.round(ratePerDayG * 10) / 10,
      ratePerWeekG: ratePerDayG === null ? null : Math.round(ratePerDayG * 7),
    };
  }

  return {
    asOf,
    entryCount,
    measuredDays: series.length,
    first,
    latest,
    previous,
    changeSincePrevious:
      latest && previous
        ? { deltaG: latest.weightG - previous.weightG, days: daysBetween(previous.date, latest.date) }
        : null,
    baseline,
    changeFromBaseline,
    averages: {
      last7: windowAverage(series, asOf, 7),
      prev7: windowAverage(series, addDays(asOf, -7), 7),
      last30: windowAverage(series, asOf, 30),
    },
    goal: goal ? goalProgress(goal, latest?.weightG ?? null) : null,
    pace: analysePace(series, asOf),
    forecast: forecastGoal(series, goal, asOf),
  };
}
