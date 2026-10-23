'use client';
import { useRouter } from 'next/navigation';
import { useRef, useState, type FormEvent } from 'react';
import { useToast } from '@/components/Toast';
import { api, ApiError, errorText } from '@/lib/api';
import { dRel, nowTimeIn, num, parseWeight, unitLabel, weight, zonedToUtc } from '@/lib/format';
import { useLoad } from '@/lib/hooks';
import { useMe } from '@/lib/session';

export default function AddPage() {
  const me = useMe();
  const u = me.weightUnit;
  const router = useRouter();
  const toast = useToast();
  const last = useLoad(() => api.summary(), []);
  const latest =
    (last.data?.summary as { latest?: { weightG: number; date: string } | null } | undefined)
      ?.latest ?? null;
  const [error, setError] = useState<string | null>(null);
  const [dup, setDup] = useState(false);
  const [busy, setBusy] = useState(false);
  // Same id for retries of this form: a timed-out request that did reach the server is not doubled.
  const clientEntryId = useRef(crypto.randomUUID());
  const input = useRef<HTMLInputElement>(null);

  function step(d: number) {
    const el = input.current;
    if (!el) return;
    const v =
      Number(el.value.replace(',', '.')) ||
      (latest ? Number(num(latest.weightG, u).replace(',', '.')) : 0);
    el.value = Math.max(0, v + d).toLocaleString('ru-RU', {
      minimumFractionDigits: 1,
      maximumFractionDigits: 1,
    });
  }

  async function submit(e: FormEvent<HTMLFormElement>, allowDuplicate = false) {
    e.preventDefault();
    const f = new FormData(e.currentTarget);
    const r = parseWeight(String(f.get('weight') ?? ''), u);
    if ('error' in r) return setError(r.error);
    const date = String(f.get('date'));
    const time = String(f.get('time') ?? '');
    if (date > me.today) return setError('Дата не может быть в будущем.');
    setBusy(true);
    setError(null);
    try {
      await api.createWeight({
        weightG: r.g,
        ...(time ? { measuredAt: zonedToUtc(date, time, me.timezone) } : { measuredOn: date }),
        note: String(f.get('note') ?? '').trim() || undefined,
        clientEntryId: clientEntryId.current,
        allowDuplicate,
      });
      toast(`Сохранено: ${weight(r.g, u)}`);
      router.push('/');
    } catch (err) {
      if (err instanceof ApiError && err.code === 'DUPLICATE_ENTRY') setDup(true);
      setError(errorText(err));
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="page" style={{ maxWidth: 560 }}>
      <div className="page-head">
        <div>
          <span className="label">Новое измерение</span>
          <h1>Записать вес</h1>
        </div>
      </div>
      <form className="card form" id="add-form" onSubmit={(e) => void submit(e, dup)} noValidate>
        <label className="field">
          <span>Вес, {unitLabel(u)}</span>
          <div className="weight-input">
            <button
              type="button"
              className="btn"
              onClick={() => step(-0.1)}
              aria-label="Меньше на 0,1"
            >
              −
            </button>
            <input
              ref={input}
              className={`input${error ? ' err' : ''}`}
              id="add-weight"
              name="weight"
              inputMode="decimal"
              autoComplete="off"
              placeholder={latest ? num(latest.weightG, u) : '0,0'}
              aria-describedby="add-weight-help"
            />
            <button
              type="button"
              className="btn"
              onClick={() => step(0.1)}
              aria-label="Больше на 0,1"
            >
              +
            </button>
          </div>
          <small id="add-weight-help">
            {latest
              ? `Последнее: ${weight(latest.weightG, u)} (${dRel(latest.date, me.today)})`
              : 'Допустимо 20–400 кг'}
          </small>
        </label>
        <div className="grid g-2">
          <label className="field">
            <span>Дата</span>
            <input
              className="input"
              type="date"
              id="add-date"
              name="date"
              defaultValue={me.today}
              max={me.today}
            />
          </label>
          <label className="field">
            <span>Время</span>
            <input
              className="input"
              type="time"
              id="add-time"
              name="time"
              defaultValue={nowTimeIn(me.timezone)}
            />
          </label>
        </div>
        <label className="field">
          <span>
            Заметка <span className="muted">(необязательно)</span>
          </span>
          <input
            className="input"
            id="add-note"
            name="note"
            maxLength={500}
            placeholder="например: после тренировки"
          />
        </label>
        <p className="small muted">
          В расчётах за день учитывается самое раннее измерение — утреннее. Остальные записи
          сохраняются в истории.
        </p>
        {error && (
          <p className="alert" role="alert">
            {error}
            {dup && ' Нажмите «Сохранить ещё раз», чтобы всё равно записать.'}
          </p>
        )}
        <div className="row">
          <button className="btn primary" type="submit" disabled={busy}>
            {busy ? 'Сохраняю…' : dup ? 'Сохранить ещё раз' : 'Сохранить'}
          </button>
          <button className="btn ghost" type="button" onClick={() => router.push('/')}>
            Отмена
          </button>
        </div>
      </form>
    </div>
  );
}
