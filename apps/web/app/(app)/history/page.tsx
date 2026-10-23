'use client';
import type { WeightEntry } from '@weight-ai/contracts';
import { toDailySeries } from '@weight-ai/core';
import Link from 'next/link';
import { Fragment, useMemo, useState, type FormEvent } from 'react';
import { ErrorState, Loading } from '@/components/Shell';
import { useToast } from '@/components/Toast';
import { api, errorText } from '@/lib/api';
import {
  days,
  delta,
  dLong,
  dShort,
  localTime,
  meas,
  MONTHS_FULL,
  num,
  parseWeight,
  unitLabel,
  weight,
  zonedToUtc,
} from '@/lib/format';
import { useLoad } from '@/lib/hooks';
import { useMe } from '@/lib/session';

const PAGE = 200;

export default function HistoryPage() {
  const me = useMe();
  const u = me.weightUnit;
  const toast = useToast();
  const [items, setItems] = useState<WeightEntry[]>([]);
  const [cursor, setCursor] = useState<string | null>(null);
  const first = useLoad(async () => {
    const r = await api.listWeights({ limit: PAGE });
    setItems(r.items);
    setCursor(r.nextCursor);
    return true;
  }, []);
  const [editId, setEditId] = useState<string | null>(null);
  const [confirmId, setConfirmId] = useState<string | null>(null);
  const [rowError, setRowError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  // Morning flag and day-to-day change are computed by the core from the loaded entries.
  const { morning, prevOf } = useMemo(() => {
    const series = toDailySeries(
      items.map((e) => ({
        id: e.id,
        measuredOn: e.measuredOn,
        measuredAt: e.measuredAt,
        weightG: e.weightG,
      })),
      me.today,
    );
    const prev = new Map<string, number>();
    series.forEach((p, i) => i > 0 && prev.set(p.date, series[i - 1]!.weightG));
    return { morning: new Set(series.map((p) => p.entryId)), prevOf: prev };
  }, [items, me.today]);
  const measuredDays = useMemo(() => new Set(items.map((e) => e.measuredOn)).size, [items]);

  async function more() {
    if (!cursor) return;
    try {
      const r = await api.listWeights({ limit: PAGE, cursor });
      setItems((x) => [...x, ...r.items]);
      setCursor(r.nextCursor);
    } catch (e) {
      toast(errorText(e));
    }
  }

  async function save(e: FormEvent<HTMLFormElement>, entry: WeightEntry) {
    e.preventDefault();
    const f = new FormData(e.currentTarget);
    const r = parseWeight(String(f.get('weight') ?? ''), u);
    if ('error' in r) return setRowError(r.error);
    const date = String(f.get('date'));
    const time = String(f.get('time') ?? '');
    if (date > me.today) return setRowError('Дата не может быть в будущем.');
    setBusy(true);
    try {
      const updated = await api.updateWeight(entry.id, {
        weightG: r.g,
        note: String(f.get('note') ?? '').trim() || null,
        ...(time
          ? { measuredAt: zonedToUtc(date, time, me.timezone) }
          : { measuredOn: date, measuredAt: null }),
      });
      setItems((x) => x.map((it) => (it.id === entry.id ? updated : it)).sort(byNewest));
      setEditId(null);
      setRowError(null);
      toast('Изменения сохранены');
    } catch (err) {
      setRowError(errorText(err));
    } finally {
      setBusy(false);
    }
  }

  async function remove(entry: WeightEntry) {
    setBusy(true);
    try {
      await api.deleteWeight(entry.id);
      setItems((x) => x.filter((it) => it.id !== entry.id));
      setConfirmId(null);
      toast('Запись удалена');
    } catch (err) {
      setRowError(errorText(err));
    } finally {
      setBusy(false);
    }
  }

  let month = '';
  return (
    <div className="page">
      <div className="page-head">
        <div>
          <span className="label">
            {first.data
              ? `${meas(items.length)} · ${days(measuredDays)} с измерениями`
              : 'Все измерения'}
          </span>
          <h1>История</h1>
        </div>
        <Link className="btn primary" href="/add">
          Записать вес
        </Link>
      </div>
      {first.error && <ErrorState text={first.error} retry={() => void first.reload()} />}
      {first.loading && !first.data && (
        <div className="card">
          <Loading lines={6} />
        </div>
      )}
      {first.data && items.length === 0 && (
        <div className="card state">
          <h2>История пуста</h2>
          <p className="muted">
            Здесь будут все измерения с датой, временем и изменением к предыдущему дню.
          </p>
          <Link className="btn primary" href="/add">
            Записать вес
          </Link>
        </div>
      )}
      {items.length > 0 && (
        <div className="card">
          <div className="list" data-testid="history">
            {items.map((e) => {
              const m = e.measuredOn.slice(0, 7);
              const header =
                m !== month ? (
                  <div className="month label">
                    {MONTHS_FULL[Number(m.slice(5)) - 1]} {m.slice(0, 4)}
                  </div>
                ) : null;
              month = m;
              const isMorning = morning.has(e.id);
              const prev = prevOf.get(e.measuredOn);
              const dlt = isMorning && prev !== undefined ? e.weightG - prev : null;
              const time = e.measuredAt ? localTime(e.measuredAt, me.timezone) : '';
              return (
                <Fragment key={e.id}>
                  {header}
                  {editId === e.id ? (
                    <form
                      className="entry-edit form"
                      onSubmit={(ev) => void save(ev, e)}
                      noValidate
                    >
                      <div className="grid g-2">
                        <label className="field">
                          <span>Вес, {unitLabel(u)}</span>
                          <input
                            className="input num"
                            id="edit-weight"
                            name="weight"
                            inputMode="decimal"
                            defaultValue={num(e.weightG, u)}
                          />
                        </label>
                        <label className="field">
                          <span>Дата</span>
                          <input
                            className="input"
                            type="date"
                            id="edit-date"
                            name="date"
                            defaultValue={e.measuredOn}
                            max={me.today}
                          />
                        </label>
                        <label className="field">
                          <span>Время</span>
                          <input
                            className="input"
                            type="time"
                            id="edit-time"
                            name="time"
                            defaultValue={time}
                          />
                        </label>
                        <label className="field">
                          <span>Заметка</span>
                          <input
                            className="input"
                            id="edit-note"
                            name="note"
                            defaultValue={e.note ?? ''}
                            maxLength={500}
                          />
                        </label>
                      </div>
                      {rowError && <span className="err-text">{rowError}</span>}
                      <div className="row">
                        <button className="btn primary sm" type="submit" disabled={busy}>
                          Сохранить
                        </button>
                        <button
                          className="btn ghost sm"
                          type="button"
                          onClick={() => (setEditId(null), setRowError(null))}
                        >
                          Отмена
                        </button>
                      </div>
                    </form>
                  ) : (
                    <div className={`entry${isMorning ? '' : ' secondary'}`}>
                      <div className="d">
                        <span>{dShort(e.measuredOn)}</span>
                        <span className="small muted num">{time || '—'}</span>
                      </div>
                      <div style={{ minWidth: 0 }}>
                        <span className="w">{weight(e.weightG, u)}</span>
                        <div className="small muted">
                          {[
                            !isMorning && 'не утреннее — в расчёт не идёт',
                            e.note,
                            e.source === 'chat' && 'через чат',
                          ]
                            .filter(Boolean)
                            .join(' · ')}
                        </div>
                      </div>
                      <span
                        className={`delta ${dlt !== null && dlt > 0 ? 'up' : dlt !== null && dlt < 0 ? 'down' : 'muted'}`}
                      >
                        {dlt !== null ? delta(dlt, u) : ''}
                      </span>
                      <div className="acts">
                        <button
                          className="btn ghost sm"
                          onClick={() => (setEditId(e.id), setConfirmId(null), setRowError(null))}
                        >
                          Изменить
                        </button>
                        <button
                          className="btn ghost sm danger"
                          onClick={() => (setConfirmId(e.id), setEditId(null), setRowError(null))}
                          aria-label={`Удалить запись за ${dShort(e.measuredOn)}`}
                        >
                          Удалить
                        </button>
                      </div>
                    </div>
                  )}
                  {confirmId === e.id && (
                    <div className="confirm" role="alertdialog" aria-label="Подтверждение удаления">
                      <span>
                        Удалить {weight(e.weightG, u)} за {dLong(e.measuredOn)}? Это нельзя
                        отменить.
                        {rowError && <span className="err-text"> {rowError}</span>}
                      </span>
                      <span className="row">
                        <button
                          className="btn sm danger solid"
                          onClick={() => void remove(e)}
                          disabled={busy}
                        >
                          Удалить
                        </button>
                        <button className="btn sm" onClick={() => setConfirmId(null)}>
                          Отмена
                        </button>
                      </span>
                    </div>
                  )}
                </Fragment>
              );
            })}
          </div>
          {cursor && (
            <div>
              <button className="btn" onClick={() => void more()}>
                Показать ещё
              </button>
            </div>
          )}
        </div>
      )}
    </div>
  );
}

function byNewest(a: WeightEntry, b: WeightEntry): number {
  if (a.measuredOn !== b.measuredOn) return a.measuredOn < b.measuredOn ? 1 : -1;
  return a.createdAt < b.createdAt ? 1 : -1;
}
