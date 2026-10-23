'use client';
import type { AnalyticsHistory } from '@weight-ai/contracts';
import {
  fromEpochDay,
  fromGrams,
  toEpochDay,
  type Forecast,
  type WeightUnit,
} from '@weight-ai/core';
import {
  CartesianGrid,
  ComposedChart,
  Line,
  ReferenceLine,
  ResponsiveContainer,
  Scatter,
  Tooltip,
  XAxis,
  YAxis,
} from 'recharts';
import { dShort, num, unitLabel } from '@/lib/format';

interface Row {
  x: number;
  w?: number;
  avg?: number;
  fc?: number;
}

/** Morning weights, 7-day average, goal line and the forecast to the goal, on one day scale. */
export function WeightChart({
  history,
  unit,
  today,
}: {
  history: AnalyticsHistory;
  unit: WeightUnit;
  today: string;
}) {
  const v = (g: number) => fromGrams(g, unit, 2);
  const rows: Row[] = history.points.map((p) => ({
    x: toEpochDay(p.date),
    w: v(p.weightG),
    avg: p.avg7G !== null ? v(p.avg7G) : undefined,
  }));
  const f = history.forecast as unknown as Forecast;
  const target = history.goal?.targetWeightG;
  if (f.status === 'ok' && f.trend && f.etaDate && target !== undefined) {
    const t0 = toEpochDay(today);
    const start = f.trend.fittedAtEndG + f.trend.slopeGPerDay * (t0 - toEpochDay(f.trend.to));
    const firstX = rows[0]?.x ?? t0;
    const eta = toEpochDay(f.etaDate);
    // Show the forecast up to the goal, but never stretch the chart beyond ~1.5× its span.
    const maxX = t0 + Math.max(14, Math.round((t0 - firstX) * 0.5));
    const endX = Math.min(eta, maxX);
    const endG = start + f.trend.slopeGPerDay * (endX - t0);
    rows.push({ x: t0, fc: v(start) }, { x: endX, fc: v(endX === eta ? target : endG) });
  }
  const values = rows
    .flatMap((r) => [r.w, r.avg, r.fc])
    .filter((n): n is number => n !== undefined);
  const tv = target !== undefined ? v(target) : undefined;
  let lo = Math.min(...values);
  let hi = Math.max(...values);
  if (tv !== undefined && (Math.abs(tv - lo) < 4 || Math.abs(tv - hi) < 4 || f.status === 'ok')) {
    lo = Math.min(lo, tv);
    hi = Math.max(hi, tv);
  }
  const pad = Math.max(0.3, (hi - lo) * 0.08);
  const domain: [number, number] = [Math.floor((lo - pad) * 2) / 2, Math.ceil((hi + pad) * 2) / 2];
  const nf = (n: number) =>
    n.toLocaleString('ru-RU', { maximumFractionDigits: 1, minimumFractionDigits: 1 });

  if (history.points.length < 2) {
    return (
      <p className="muted" style={{ padding: '40px 0', textAlign: 'center' }}>
        Нужно минимум два дня измерений, чтобы построить график.
      </p>
    );
  }
  return (
    <div
      className="chart-box"
      role="img"
      aria-label={`График веса с ${dShort(history.from)} по ${dShort(history.to)}`}
    >
      <ResponsiveContainer width="100%" height="100%">
        <ComposedChart data={rows} margin={{ top: 10, right: 12, bottom: 0, left: 0 }}>
          <CartesianGrid stroke="var(--line)" vertical={false} />
          <XAxis
            dataKey="x"
            type="number"
            domain={['dataMin', 'dataMax']}
            tickFormatter={(x: number) => dShort(fromEpochDay(x))}
            tickCount={5}
            tick={{ fill: 'var(--muted)', fontSize: 11 }}
            axisLine={{ stroke: 'var(--line)' }}
            tickLine={false}
          />
          <YAxis
            domain={domain}
            width={44}
            tickFormatter={nf}
            tick={{ fill: 'var(--muted)', fontSize: 11 }}
            axisLine={false}
            tickLine={false}
          />
          <Tooltip
            content={({ active, payload }) => {
              const r = active ? (payload?.[0]?.payload as Row | undefined) : undefined;
              if (!r) return null;
              const parts = [dShort(fromEpochDay(r.x))];
              if (r.w !== undefined) parts.push(`${nf(r.w)} ${unitLabel(unit)}`);
              if (r.avg !== undefined) parts.push(`ср. 7 дн ${nf(r.avg)}`);
              if (r.fc !== undefined && r.w === undefined) parts.push(`прогноз ${nf(r.fc)}`);
              return <div className="chart-tip">{parts.join(' · ')}</div>;
            }}
          />
          {tv !== undefined && (
            <ReferenceLine
              y={tv}
              stroke="var(--good)"
              strokeDasharray="6 4"
              label={{
                value: `цель ${num(target!, unit)}`,
                position: 'insideTopRight',
                fill: 'var(--good)',
                fontSize: 11,
              }}
            />
          )}
          <ReferenceLine x={toEpochDay(today)} stroke="var(--line)" strokeDasharray="3 3" />
          <Scatter
            dataKey="w"
            fill="var(--chart-pt)"
            fillOpacity={0.75}
            isAnimationActive={false}
            shape={(p: { cx?: number; cy?: number; payload?: Row }) =>
              p.payload?.w === undefined ? (
                <g />
              ) : (
                <circle cx={p.cx} cy={p.cy} r={3} fill="var(--chart-pt)" fillOpacity={0.75} />
              )
            }
          />
          <Line
            dataKey="avg"
            stroke="var(--accent)"
            strokeWidth={2.5}
            dot={false}
            connectNulls
            isAnimationActive={false}
          />
          <Line
            dataKey="fc"
            stroke="var(--accent)"
            strokeWidth={2}
            strokeDasharray="5 5"
            dot={false}
            connectNulls
            isAnimationActive={false}
          />
        </ComposedChart>
      </ResponsiveContainer>
    </div>
  );
}
