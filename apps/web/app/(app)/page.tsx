'use client';
import type { Forecast, Summary } from '@weight-ai/core';
import { addDays } from '@weight-ai/core';
import Link from 'next/link';
import { useState, type FormEvent } from 'react';
import { ErrorState, Loading } from '@/components/Shell';
import { useToast } from '@/components/Toast';
import { WeightChart } from '@/components/WeightChart';
import { api, errorText } from '@/lib/api';
import {
  dLong,
  dRel,
  days,
  delta,
  dShort,
  meas,
  num,
  parseWeight,
  perWeek,
  unitLabel,
  weight,
} from '@/lib/format';
import { useLoad } from '@/lib/hooks';
import { useMe } from '@/lib/session';

const PACE: Record<string, [string, string]> = {
  accelerating: ['Ускоряется', 'accent'],
  slowing: ['Замедляется', 'warn'],
  stable: ['Стабильно', 'good'],
  reversed: ['Сменил направление', 'bad'],
  insufficient_data: ['Мало данных', ''],
};
const FORECAST: Record<string, string> = {
  no_goal: 'Цель не задана.',
  maintain_goal: 'Цель — удержание веса; дата достижения не считается.',
  achieved: 'Цель уже достигнута по последнему измерению.',
  insufficient_data: 'Нужно минимум 5 измерений за последние 28 дней, охватывающих 10+ дней.',
  no_trend: 'Вес почти не меняется — надёжного тренда нет.',
  moving_away: 'Последний тренд направлен от цели.',
  too_far: 'При текущем темпе цель дальше чем через 2 года.',
};
const GOAL_STATUS: Record<string, [string, string]> = {
  in_progress: ['В процессе', 'accent'],
  achieved: ['Достигнута', 'good'],
  exceeded: ['Перевыполнена', 'good'],
  within_range: ['В коридоре', 'good'],
  outside_range: ['Вне коридора', 'warn'],
  no_data: ['Нет данных', ''],
};

function greeting(): string {
  const h = new Date().getHours();
  if (h < 5) return 'Доброй ночи';
  if (h < 12) return 'Доброе утро';
  if (h < 18) return 'Добрый день';
  return 'Добрый вечер';
}

export default function Dashboard() {
  const me = useMe();
  const u = me.weightUnit;
  const [range, setRange] = useState(90);
  const summary = useLoad(() => api.summary(), []);
  const history = useLoad(
    () => api.history(range ? { from: addDays(me.today, -(range - 1)) } : { from: '2000-01-01' }),
    [range],
  );
  const reloadAll = () => {
    void summary.reload();
    void history.reload();
  };

  const s = summary.data?.summary as unknown as Summary | undefined;
  return (
    <div className="page">
      <div className="page-head">
        <div>
          <span className="label">{dLong(me.today)}</span>
          <h1>
            {greeting()}
            {me.displayName ? `, ${me.displayName}` : ''}
          </h1>
        </div>
        <Link className="btn primary" href="/add">
          Записать вес
        </Link>
      </div>
      {summary.error && <ErrorState text={summary.error} retry={reloadAll} />}
      {!s && !summary.error && (
        <div className="card">
          <Loading lines={4} />
        </div>
      )}
      {s && !s.latest && (
        <div className="card state">
          <h2>Пока нет измерений</h2>
          <p className="muted">
            Запишите первый утренний вес — здесь появятся график, средние за 7 и 30 дней и прогноз.
          </p>
          <div className="row">
            <Link className="btn primary" href="/add">
              Записать вес
            </Link>
            <Link className="btn" href="/chat">
              Написать в чат
            </Link>
          </div>
        </div>
      )}
      {s?.latest && (
        <>
          <div className="grid g-hero">
            <Hero s={s} unit={u} today={me.today} onSaved={reloadAll} />
            <GoalCard s={s} unit={u} />
          </div>
          <Tiles s={s} unit={u} />
          <div className="card">
            <div className="card-head">
              <h2>Вес по утрам</h2>
              <div className="seg" role="group" aria-label="Период">
                {[30, 90, 0].map((n) => (
                  <button key={n} aria-pressed={range === n} onClick={() => setRange(n)}>
                    {n ? `${n} дн` : 'Всё'}
                  </button>
                ))}
              </div>
            </div>
            {history.error && (
              <ErrorState text={history.error} retry={() => void history.reload()} />
            )}
            {history.data ? (
              <WeightChart history={history.data} unit={u} today={me.today} />
            ) : (
              !history.error && <Loading />
            )}
            <div className="legend">
              <span>
                <i style={{ background: 'var(--chart-pt)' }} />
                утреннее измерение
              </span>
              <span>
                <i style={{ background: 'var(--accent)' }} />
                среднее за 7 дней
              </span>
              {s.goal && (
                <span>
                  <i style={{ background: 'var(--good)' }} />
                  цель
                </span>
              )}
              {s.forecast.status === 'ok' && (
                <span>
                  <i style={{ background: 'var(--accent)', opacity: 0.5 }} />
                  прогноз
                </span>
              )}
            </div>
          </div>
        </>
      )}
      <p className="disclaimer">
        Weight AI не является медицинским инструментом. Изменение веса на весах не говорит напрямую
        о жире, воде или мышцах; по вопросам здоровья обращайтесь к врачу.
      </p>
    </div>
  );
}

function Hero({
  s,
  unit,
  today,
  onSaved,
}: {
  s: Summary;
  unit: 'kg' | 'lb';
  today: string;
  onSaved: () => void;
}) {
  const toast = useToast();
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const latest = s.latest!;
  const cp = s.changeSincePrevious;
  async function quick(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const form = e.currentTarget;
    const r = parseWeight(String(new FormData(form).get('weight') ?? ''), unit);
    if ('error' in r) return setError(r.error);
    setBusy(true);
    try {
      await api.createWeight({ weightG: r.g, measuredAt: new Date().toISOString() });
      setError(null);
      form.reset();
      toast(`Сохранено: ${weight(r.g, unit)}`);
      onSaved();
    } catch (err) {
      setError(errorText(err));
    } finally {
      setBusy(false);
    }
  }
  return (
    <div className="card">
      <span className="label">Последнее утреннее</span>
      <div className="readout">
        <span className="big" data-testid="latest-weight">
          {num(latest.weightG, unit)}
        </span>
        <span className="unit">{unitLabel(unit)}</span>
      </div>
      <div className="hero-row">
        {cp && s.previous && (
          <span className={`chip ${cp.deltaG < 0 ? 'good' : cp.deltaG > 0 ? 'warn' : ''}`}>
            {delta(cp.deltaG, unit)} к {dRel(s.previous.date, today)}
          </span>
        )}
        <span className="chip">{dRel(latest.date, today)}</span>
        {latest.entryCount > 1 && (
          <span className="chip">{latest.entryCount} записи за день — учтена первая</span>
        )}
      </div>
      <form className="quick" onSubmit={quick} noValidate>
        <label className="field">
          <span>
            {latest.date === today ? 'Ещё одно измерение сегодня' : 'Сегодня ещё не взвешивались'}
          </span>
          <div className="row">
            <input
              className={`input num${error ? ' err' : ''}`}
              id="quick-weight"
              name="weight"
              inputMode="decimal"
              placeholder={num(latest.weightG, unit)}
              autoComplete="off"
              aria-label={`Вес, ${unitLabel(unit)}`}
            />
            <button className="btn primary" type="submit" disabled={busy}>
              Записать
            </button>
          </div>
        </label>
        {error && (
          <span className="err-text" role="alert">
            {error}
          </span>
        )}
      </form>
    </div>
  );
}

function GoalCard({ s, unit }: { s: Summary; unit: 'kg' | 'lb' }) {
  const g = s.goal;
  if (!g) {
    return (
      <div className="card">
        <span className="label">Цель</span>
        <p className="muted">
          Цель не задана. Задайте целевой вес, чтобы видеть прогресс и прогноз.
        </p>
        <div>
          <Link className="btn" href="/settings#goal">
            Задать цель
          </Link>
        </div>
      </div>
    );
  }
  const f: Forecast = s.forecast;
  const pct = g.progressPct === null ? null : Math.max(0, Math.min(100, g.progressPct));
  const [label, tone] = GOAL_STATUS[g.status] ?? ['', ''];
  const dir = { lose: 'снижение', gain: 'набор', maintain: 'удержание' }[g.direction];
  return (
    <div className="card">
      <div className="card-head">
        <span className="label">Цель · {dir}</span>
        <span className={`chip ${tone}`}>{label}</span>
      </div>
      <div className="readout">
        <span className="num" style={{ fontSize: '1.6rem' }}>
          {weight(g.targetWeightG, unit)}
        </span>
        {g.remainingG !== null && (
          <span className="muted">осталось {weight(Math.abs(g.remainingG), unit)}</span>
        )}
      </div>
      {pct !== null && (
        <>
          <div
            className="bar"
            role="progressbar"
            aria-valuenow={Math.round(pct)}
            aria-valuemin={0}
            aria-valuemax={100}
            aria-label="Прогресс цели"
          >
            <span style={{ width: `${pct}%` }} />
          </div>
          <div className="bar-ends">
            <span className="num">{weight(g.startWeightG, unit)}</span>
            <span className="num">{Math.round(g.progressPct!)} %</span>
            <span className="num">{weight(g.targetWeightG, unit)}</span>
          </div>
        </>
      )}
      <div>
        <span className="label">Прогноз</span>
        {f.status === 'ok' && f.etaDate && f.trend ? (
          <>
            <p>
              <span className="num" style={{ fontSize: '1.15rem' }}>
                ≈ {dLong(f.etaDate)}
              </span>{' '}
              <span className="muted">через {days(f.etaDays ?? 0)}</span>
            </p>
            <p className="small muted">
              {f.range &&
                `80 % интервал: ${dShort(f.range.earliest)} — ${f.range.latest ? dShort(f.range.latest) : 'позже 2 лет'} · `}
              тренд {perWeek(f.trend.slopeGPerDay, unit)} по {f.trend.points} дням
            </p>
          </>
        ) : (
          <p className="small muted">{FORECAST[f.status] ?? f.reason}</p>
        )}
      </div>
    </div>
  );
}

function Tiles({ s, unit }: { s: Summary; unit: 'kg' | 'lb' }) {
  const { last7, prev7, last30 } = s.averages;
  const diff = last7.avgG !== null && prev7.avgG !== null ? last7.avgG - prev7.avgG : null;
  const [paceLabel, paceTone] = PACE[s.pace.classification] ?? ['', ''];
  const base = s.changeFromBaseline;
  return (
    <div className="grid g-4">
      <div className="card stat">
        <span className="label">Среднее, 7 дней</span>
        <span className="v">
          {last7.avgG !== null ? weight(Math.round(last7.avgG), unit) : '—'}
        </span>
        <span className="sub">
          {meas(last7.count)}
          {diff !== null && ` · ${delta(Math.round(diff), unit)} к прошлой неделе`}
        </span>
      </div>
      <div className="card stat">
        <span className="label">Среднее, 30 дней</span>
        <span className="v">
          {last30.avgG !== null ? weight(Math.round(last30.avgG), unit) : '—'}
        </span>
        <span className="sub">{meas(last30.count)} из 30 дней</span>
      </div>
      <div className="card stat">
        <span className="label">Темп, 14 дней</span>
        <span className="v">{s.pace.recent ? perWeek(s.pace.recent.slopeGPerDay, unit) : '—'}</span>
        <span className="sub">
          <span className={`chip ${paceTone}`}>{paceLabel}</span>
          {s.pace.previous && ` до этого ${perWeek(s.pace.previous.slopeGPerDay, unit)}`}
        </span>
      </div>
      <div className="card stat">
        <span className="label">
          {s.baseline?.source === 'goal' ? 'С начала цели' : 'С первой записи'}
        </span>
        <span className="v">{base ? delta(base.deltaG, unit) : '—'}</span>
        <span className="sub">
          {base && `за ${days(base.days)}`}
          {base?.ratePerWeekG != null && ` · ${delta(base.ratePerWeekG, unit)}/нед`}
        </span>
      </div>
    </div>
  );
}
