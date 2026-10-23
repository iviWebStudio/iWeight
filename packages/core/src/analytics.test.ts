import { describe, expect, it } from 'vitest';
import {
  addDays,
  analysePace,
  computeSummary,
  daysBetween,
  forecastGoal,
  goalProgress,
  isValidLocalDate,
  linearTrend,
  localDateInTimeZone,
  toDailySeries,
  toGrams,
  fromGrams,
  formatDelta,
  windowAverage,
  type WeightEntryInput,
} from './index.js';

const e = (measuredOn: string, kg: number, extra: Partial<WeightEntryInput> = {}): WeightEntryInput => ({
  measuredOn,
  weightG: Math.round(kg * 1000),
  ...extra,
});

/** Builds a daily linear series: start kg, change per day in grams. */
function linear(start: string, days: number, startKg: number, gPerDay: number, every = 1) {
  const out: WeightEntryInput[] = [];
  for (let i = 0; i < days; i += every) {
    out.push({ measuredOn: addDays(start, i), weightG: Math.round(startKg * 1000 + gPerDay * i) });
  }
  return out;
}

describe('dates', () => {
  it('validates real calendar dates', () => {
    expect(isValidLocalDate('2024-02-29')).toBe(true); // leap year
    expect(isValidLocalDate('2023-02-29')).toBe(false);
    expect(isValidLocalDate('2026-13-01')).toBe(false);
    expect(isValidLocalDate('2026-04-31')).toBe(false);
    expect(isValidLocalDate('26-04-01')).toBe(false);
    expect(isValidLocalDate('not a date')).toBe(false);
  });

  it('counts calendar days across month, year and leap boundaries', () => {
    expect(daysBetween('2026-01-31', '2026-02-01')).toBe(1);
    expect(daysBetween('2025-12-31', '2026-01-01')).toBe(1);
    expect(daysBetween('2024-02-28', '2024-03-01')).toBe(2); // includes Feb 29
    expect(daysBetween('2023-02-28', '2023-03-01')).toBe(1);
    expect(daysBetween('2024-01-01', '2025-01-01')).toBe(366);
    expect(daysBetween('2026-10-23', '2026-10-23')).toBe(0);
  });

  it('is immune to DST (Europe/Berlin switches on 2026-03-29)', () => {
    expect(daysBetween('2026-03-28', '2026-03-30')).toBe(2);
  });

  it('resolves the local date of an instant per time zone', () => {
    const instant = new Date('2026-10-23T22:30:00Z');
    expect(localDateInTimeZone(instant, 'Asia/Yerevan')).toBe('2026-10-24'); // UTC+4
    expect(localDateInTimeZone(instant, 'America/Los_Angeles')).toBe('2026-10-23');
    expect(localDateInTimeZone(instant, 'UTC')).toBe('2026-10-23');
    expect(() => localDateInTimeZone(instant, 'Mars/Olympus')).toThrow();
  });
});

describe('units', () => {
  it('converts to integer grams', () => {
    expect(toGrams(82.4, 'kg')).toBe(82400);
    expect(toGrams(180, 'lb')).toBe(81647); // 180 × 453.59237 = 81646.6266
    expect(fromGrams(81647, 'lb')).toBe(180);
    expect(() => toGrams(-1, 'kg')).toThrow();
    expect(() => toGrams(Number.NaN, 'kg')).toThrow();
  });
  it('formats deltas with sign', () => {
    expect(formatDelta(-400, 'kg')).toBe('−0.4 kg');
    expect(formatDelta(1200, 'kg')).toBe('+1.2 kg');
    expect(formatDelta(0, 'kg')).toBe('0.0 kg');
  });
});

describe('daily series', () => {
  it('uses the earliest measurement of a day and keeps the count', () => {
    const s = toDailySeries([
      e('2026-10-01', 80.5, { measuredAt: '2026-10-01T18:00:00Z', id: 'evening' }),
      e('2026-10-01', 80.0, { measuredAt: '2026-10-01T05:00:00Z', id: 'morning' }),
      e('2026-10-02', 79.9),
    ]);
    expect(s).toHaveLength(2);
    expect(s[0]).toMatchObject({ date: '2026-10-01', weightG: 80000, entryCount: 2, entryId: 'morning' });
  });

  it('prefers timed entries over untimed ones on the same day', () => {
    const s = toDailySeries([e('2026-10-01', 81, { id: 'b' }), e('2026-10-01', 80, { id: 'a', measuredAt: '2026-10-01T07:00:00Z' })]);
    expect(s[0]!.entryId).toBe('a');
  });

  it('keeps exact duplicates deterministic (single daily value)', () => {
    const s = toDailySeries([e('2026-10-01', 80, { id: '2' }), e('2026-10-01', 80, { id: '1' })]);
    expect(s).toEqual([{ date: '2026-10-01', weightG: 80000, entryCount: 2, entryId: '1' }]);
  });

  it('ignores future entries relative to asOf', () => {
    expect(toDailySeries([e('2026-10-01', 80), e('2026-10-30', 70)], '2026-10-23')).toHaveLength(1);
  });

  it('rejects invalid data', () => {
    expect(() => toDailySeries([e('2026-02-30', 80)])).toThrow(/Invalid calendar date/);
    expect(() => toDailySeries([{ measuredOn: '2026-10-01', weightG: 5 }])).toThrow(/grams/);
    expect(() => toDailySeries([{ measuredOn: '2026-10-01', weightG: 80000.5 }])).toThrow();
  });
});

describe('window averages', () => {
  it('averages only measured days and reports the count (gaps are not filled)', () => {
    // Measured on 3 of the last 7 days: 80, 79, 78 → 79.0
    const s = toDailySeries([e('2026-10-17', 80), e('2026-10-20', 79), e('2026-10-23', 78), e('2026-10-10', 90)]);
    const w = windowAverage(s, '2026-10-23', 7);
    expect(w).toEqual({ from: '2026-10-17', to: '2026-10-23', calendarDays: 7, count: 3, avgG: 79000 });
  });

  it('returns null avg for an empty window', () => {
    const w = windowAverage(toDailySeries([e('2026-09-01', 80)]), '2026-10-23', 7);
    expect(w.count).toBe(0);
    expect(w.avgG).toBeNull();
  });

  it('30-day window spans month boundary', () => {
    const s = toDailySeries([e('2026-09-24', 82), e('2026-09-23', 99), e('2026-10-23', 80)]);
    const w = windowAverage(s, '2026-10-23', 30);
    expect(w.from).toBe('2026-09-24');
    expect(w.count).toBe(2);
    expect(w.avgG).toBe(81000);
  });
});

describe('linear trend (independently verified)', () => {
  it('recovers an exact slope', () => {
    const t = linearTrend(toDailySeries(linear('2026-10-01', 10, 90, -100)))!;
    expect(t.slopeGPerDay).toBeCloseTo(-100, 9);
    expect(t.slopeGPerWeek).toBeCloseTo(-700, 9);
    expect(t.stdErrorGPerDay).toBeCloseTo(0, 9);
    expect(t.fittedAtEndG).toBeCloseTo(89100, 6);
  });

  it('matches a hand-computed OLS example with irregular gaps', () => {
    // x = 0,1,3,6 ; y = 80000, 79800, 79700, 79100
    // mean x = 2.5, mean y = 79650 ; Sxx = 6.25+2.25+0.25+12.25 = 21
    // Sxy = (-2.5)(350)+(-1.5)(150)+(0.5)(50)+(3.5)(-550) = -875-225+25-1925 = -3000
    // slope = -3000/21 = -142.857...
    const t = linearTrend(
      toDailySeries([e('2026-10-01', 80), e('2026-10-02', 79.8), e('2026-10-04', 79.7), e('2026-10-07', 79.1)]),
    )!;
    expect(t.slopeGPerDay).toBeCloseTo(-3000 / 21, 9);
  });

  it('returns null for <2 points or all on one day', () => {
    expect(linearTrend(toDailySeries([e('2026-10-01', 80)]))).toBeNull();
  });
});

describe('goal progress', () => {
  const lose = { startWeightG: 90000, targetWeightG: 80000, startDate: '2026-09-01' };
  const gain = { startWeightG: 60000, targetWeightG: 66000, startDate: '2026-09-01' };

  it('loss goal: 85 kg is 50 %', () => {
    const g = goalProgress(lose, 85000);
    expect(g).toMatchObject({ direction: 'lose', doneG: -5000, remainingG: -5000, progressPct: 50, status: 'in_progress' });
  });

  it('gain goal: 63 kg is 50 % (separate direction, same formula meaning)', () => {
    const g = goalProgress(gain, 63000);
    expect(g).toMatchObject({ direction: 'gain', doneG: 3000, remainingG: 3000, progressPct: 50, status: 'in_progress' });
  });

  it('achieved within 100 g tolerance', () => {
    expect(goalProgress(lose, 80050).status).toBe('achieved');
    expect(goalProgress(gain, 65950).status).toBe('achieved');
  });

  it('exceeded beyond target', () => {
    const g = goalProgress(lose, 79000);
    expect(g.status).toBe('exceeded');
    expect(g.progressPct).toBe(110);
    expect(goalProgress(gain, 67000).status).toBe('exceeded');
  });

  it('moving away gives negative progress', () => {
    expect(goalProgress(lose, 91000).progressPct).toBe(-10);
  });

  it('maintenance goal uses a band, no percentage', () => {
    const m = { startWeightG: 75000, targetWeightG: 75000, startDate: '2026-09-01' };
    expect(goalProgress(m, 75800)).toMatchObject({ direction: 'maintain', status: 'within_range', progressPct: null });
    expect(goalProgress(m, 76500).status).toBe('outside_range');
  });

  it('no data', () => {
    expect(goalProgress(lose, null).status).toBe('no_data');
  });
});

describe('pace analysis', () => {
  it('needs enough data', () => {
    expect(analysePace(toDailySeries(linear('2026-10-20', 4, 80, -100)), '2026-10-23').classification).toBe(
      'insufficient_data',
    );
  });

  it('detects slowing', () => {
    // previous 14 days: −150 g/day, recent 14 days: −50 g/day
    const prev = linear('2026-09-26', 14, 90, -150);
    const recent = linear('2026-10-10', 14, 90 - 0.15 * 14, -50);
    const p = analysePace(toDailySeries([...prev, ...recent]), '2026-10-23');
    expect(p.classification).toBe('slowing');
    expect(p.recent!.slopeGPerDay).toBeCloseTo(-50, 6);
    expect(p.previous!.slopeGPerDay).toBeCloseTo(-150, 6);
  });

  it('detects accelerating', () => {
    const prev = linear('2026-09-26', 14, 90, -40);
    const recent = linear('2026-10-10', 14, 89, -120);
    expect(analysePace(toDailySeries([...prev, ...recent]), '2026-10-23').classification).toBe('accelerating');
  });

  it('detects reversal', () => {
    const prev = linear('2026-09-26', 14, 90, -100);
    const recent = linear('2026-10-10', 14, 88, 100);
    expect(analysePace(toDailySeries([...prev, ...recent]), '2026-10-23').classification).toBe('reversed');
  });

  it('stable', () => {
    const all = linear('2026-09-26', 28, 90, -100);
    expect(analysePace(toDailySeries(all), '2026-10-23').classification).toBe('stable');
  });
});

describe('forecast', () => {
  const goal = { startWeightG: 90000, targetWeightG: 85000, startDate: '2026-09-26' };
  const asOf = '2026-10-23';

  it('no goal', () => {
    expect(forecastGoal([], null, asOf).status).toBe('no_goal');
  });

  it('withholds a forecast with insufficient data', () => {
    const s = toDailySeries(linear('2026-10-20', 4, 90, -100));
    expect(forecastGoal(s, goal, asOf).status).toBe('insufficient_data');
  });

  it('withholds a forecast when points span too few days', () => {
    const s = toDailySeries(linear('2026-10-17', 7, 90, -100));
    expect(forecastGoal(s, goal, asOf).status).toBe('insufficient_data');
  });

  it('exact linear loss: 100 g/day, 28 days ending at 87.3 kg → 23 days to 85 kg', () => {
    // day0 = 2026-09-26 → 90.0 kg ; day27 = 2026-10-23 → 87.3 kg ; remaining 2300 g / 100 = 23
    const s = toDailySeries(linear('2026-09-26', 28, 90, -100));
    const f = forecastGoal(s, goal, asOf);
    expect(f.status).toBe('ok');
    expect(f.etaDays).toBe(23);
    expect(f.etaDate).toBe('2026-11-15');
    // zero residuals → zero-width interval
    expect(f.range).toEqual({ earliest: '2026-11-15', latest: '2026-11-15', confidence: 0.8 });
  });

  it('noisy data gives a widening interval that contains the point estimate', () => {
    const noise = [0, 300, -200, 150, -300, 250, -100, 200, -250, 100, 0, -150, 300, -200];
    const s = toDailySeries(
      linear('2026-09-26', 28, 90, -100, 2).map((x, i) => ({ ...x, weightG: x.weightG + noise[i]! })),
    );
    const f = forecastGoal(s, goal, asOf);
    expect(f.status).toBe('ok');
    expect(f.range!.earliest <= f.etaDate!).toBe(true);
    expect(f.range!.latest === null || f.range!.latest >= f.etaDate!).toBe(true);
  });

  it('flat weight → no trend', () => {
    const noise = [0, 200, -200, 100, -100, 0, 200, -200, 100, -100, 0, 50];
    const s = toDailySeries(linear('2026-10-01', 12, 88, 0).map((x, i) => ({ ...x, weightG: x.weightG + noise[i]! })));
    expect(forecastGoal(s, goal, asOf).status).toBe('no_trend');
  });

  it('moving away from a loss goal', () => {
    const s = toDailySeries(linear('2026-10-01', 20, 88, 80));
    expect(forecastGoal(s, goal, asOf).status).toBe('moving_away');
  });

  it('gain goal uses the gain direction', () => {
    const gain = { startWeightG: 60000, targetWeightG: 62000, startDate: '2026-09-26' };
    const s = toDailySeries(linear('2026-09-26', 28, 60, 50)); // ends 61.35 kg
    const f = forecastGoal(s, gain, asOf);
    expect(f.status).toBe('ok');
    expect(f.etaDays).toBe(13); // 650 / 50
  });

  it('already achieved', () => {
    const s = toDailySeries([...linear('2026-09-26', 27, 90, -100), e('2026-10-23', 84.9)]);
    expect(forecastGoal(s, goal, asOf).status).toBe('achieved');
  });

  it('too far away', () => {
    const far = { startWeightG: 120000, targetWeightG: 70000, startDate: '2026-09-26' };
    const s = toDailySeries(linear('2026-09-26', 28, 120, -10));
    expect(forecastGoal(s, far, asOf).status).toBe('too_far');
  });

  it('maintenance goals never get a date', () => {
    const m = { startWeightG: 80000, targetWeightG: 80000, startDate: '2026-09-26' };
    expect(forecastGoal(toDailySeries(linear('2026-09-26', 28, 80, -100)), m, asOf).status).toBe('maintain_goal');
  });
});

describe('summary', () => {
  it('handles no data at all', () => {
    const s = computeSummary([], null, '2026-10-23');
    expect(s.latest).toBeNull();
    expect(s.changeFromBaseline).toBeNull();
    expect(s.averages.last7.avgG).toBeNull();
    expect(s.forecast.status).toBe('no_goal');
    expect(s.pace.classification).toBe('insufficient_data');
  });

  it('zero elapsed days → rate is null, not Infinity/NaN', () => {
    const s = computeSummary([e('2026-10-23', 80)], null, '2026-10-23');
    expect(s.changeFromBaseline).toEqual({ deltaG: 0, days: 0, ratePerDayG: null, ratePerWeekG: null });
    expect(s.changeSincePrevious).toBeNull();
  });

  it('computes change and rate with gaps (independent example)', () => {
    // 2026-10-01: 82.0 → 2026-10-21: 80.6 ; 20 days ; −1400 g ; −70 g/day ; −490 g/week
    const s = computeSummary(
      [e('2026-10-01', 82), e('2026-10-08', 81.5), e('2026-10-21', 80.6)],
      null,
      '2026-10-23',
    );
    expect(s.changeFromBaseline).toEqual({ deltaG: -1400, days: 20, ratePerDayG: -70, ratePerWeekG: -490 });
    expect(s.changeSincePrevious).toEqual({ deltaG: -900, days: 13 });
    expect(s.baseline!.source).toBe('first_entry');
  });

  it('uses the goal start as baseline when a goal exists', () => {
    const s = computeSummary(
      [e('2026-10-21', 80)],
      { startWeightG: 82000, targetWeightG: 78000, startDate: '2026-10-01' },
      '2026-10-23',
    );
    expect(s.baseline).toEqual({ weightG: 82000, date: '2026-10-01', source: 'goal' });
    expect(s.changeFromBaseline!.deltaG).toBe(-2000);
    expect(s.goal!.progressPct).toBe(50);
  });

  it('multiple entries per day count as one measured day', () => {
    const s = computeSummary(
      [e('2026-10-23', 80, { measuredAt: '2026-10-23T05:00:00Z' }), e('2026-10-23', 81, { measuredAt: '2026-10-23T20:00:00Z' })],
      null,
      '2026-10-23',
    );
    expect(s.entryCount).toBe(2);
    expect(s.measuredDays).toBe(1);
    expect(s.latest!.weightG).toBe(80000);
  });

  it('rejects an invalid asOf', () => {
    expect(() => computeSummary([], null, '2026-02-30')).toThrow();
  });
});
