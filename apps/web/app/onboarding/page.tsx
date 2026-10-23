'use client';
import type { WeightUnit } from '@weight-ai/core';
import { localDateInTimeZone } from '@weight-ai/core';
import { useRouter } from 'next/navigation';
import { useState, type FormEvent } from 'react';
import { TimezoneSelect } from '@/components/TimezoneSelect';
import { api, errorText } from '@/lib/api';
import { parseWeight, unitLabel } from '@/lib/format';
import { useGuard } from '@/lib/session';

function detectTz(): string {
  try {
    return Intl.DateTimeFormat().resolvedOptions().timeZone || 'UTC';
  } catch {
    return 'UTC';
  }
}

export default function OnboardingPage() {
  const s = useGuard('onboarding');
  const router = useRouter();
  const [step, setStep] = useState(1);
  const [unit, setUnit] = useState<WeightUnit>('kg');
  const [tz, setTz] = useState(detectTz);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  if (s.status !== 'ready') return <div className="center muted">Загрузка…</div>;

  async function profile(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const name = String(new FormData(e.currentTarget).get('name') ?? '').trim();
    if (!name) return setError('Введите имя.');
    setBusy(true);
    setError(null);
    try {
      s.setMe(await api.updateMe({ displayName: name, weightUnit: unit, timezone: tz }));
      setStep(2);
    } catch (err) {
      setError(errorText(err));
    } finally {
      setBusy(false);
    }
  }

  async function start(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const f = new FormData(e.currentTarget);
    const cur = parseWeight(String(f.get('weight') ?? ''), unit);
    if ('error' in cur) return setError(cur.error);
    const targetRaw = String(f.get('target') ?? '').trim();
    const target = targetRaw ? parseWeight(targetRaw, unit) : null;
    if (target && 'error' in target) return setError(`Цель: ${target.error}`);
    setBusy(true);
    setError(null);
    try {
      await api.createWeight({
        weightG: cur.g,
        measuredAt: new Date().toISOString(),
        clientEntryId: onboardingEntryId,
      });
      if (target)
        await api.setGoal({
          targetWeightG: target.g,
          startWeightG: cur.g,
          startDate: localDateInTimeZone(new Date(), tz),
        });
      s.setMe(await api.updateMe({ onboarded: true }));
      router.replace('/');
    } catch (err) {
      setError(errorText(err));
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="auth">
      {step === 1 ? (
        <form className="card form" onSubmit={profile} noValidate>
          <div className="steps">
            <span className="on" />
            <span />
          </div>
          <div>
            <span className="label">Шаг 1 из 2</span>
            <h1>Профиль</h1>
          </div>
          <label className="field">
            <span>Как к вам обращаться</span>
            <input
              className="input"
              id="name"
              name="name"
              maxLength={80}
              defaultValue={s.me?.displayName ?? ''}
              required
            />
          </label>
          <label className="field">
            <span>Единицы</span>
            <select
              className="input"
              id="unit"
              value={unit}
              onChange={(e) => setUnit(e.target.value as WeightUnit)}
            >
              <option value="kg">Килограммы</option>
              <option value="lb">Фунты</option>
            </select>
          </label>
          <label className="field">
            <span>Часовой пояс</span>
            <TimezoneSelect id="tz" value={tz} onChange={setTz} />
            <small>Определён по устройству. По нему считается «сегодня» для ваших записей.</small>
          </label>
          {error && (
            <p className="err-text" role="alert">
              {error}
            </p>
          )}
          <button className="btn primary" type="submit" disabled={busy}>
            Далее
          </button>
        </form>
      ) : (
        <form className="card form" onSubmit={start} noValidate>
          <div className="steps">
            <span className="on" />
            <span className="on" />
          </div>
          <div>
            <span className="label">Шаг 2 из 2</span>
            <h1>Вес и цель</h1>
          </div>
          <label className="field">
            <span>Текущий вес, {unitLabel(unit)}</span>
            <input
              className="input num"
              id="weight"
              name="weight"
              inputMode="decimal"
              autoComplete="off"
              required
            />
          </label>
          <label className="field">
            <span>
              Целевой вес, {unitLabel(unit)} <span className="muted">(можно позже)</span>
            </span>
            <input
              className="input num"
              id="target"
              name="target"
              inputMode="decimal"
              autoComplete="off"
            />
          </label>
          {error && (
            <p className="err-text" role="alert">
              {error}
            </p>
          )}
          <button className="btn primary" type="submit" disabled={busy}>
            {busy ? 'Сохраняю…' : 'Начать'}
          </button>
          <button className="btn ghost" type="button" onClick={() => setStep(1)}>
            Назад
          </button>
        </form>
      )}
    </div>
  );
}

/** One id per page load: a retried submit cannot record the starting weight twice. */
const onboardingEntryId =
  typeof crypto !== 'undefined' && 'randomUUID' in crypto ? crypto.randomUUID() : undefined;
