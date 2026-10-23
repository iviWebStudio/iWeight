'use client';
import type { Me, MemoryItem, PatchMe } from '@weight-ai/contracts';
import { useRouter } from 'next/navigation';
import { useState, type FormEvent } from 'react';
import { ErrorState, Loading } from '@/components/Shell';
import { TimezoneSelect } from '@/components/TimezoneSelect';
import { useToast } from '@/components/Toast';
import { api, errorText } from '@/lib/api';
import { num, parseWeight, unitLabel } from '@/lib/format';
import { useLoad } from '@/lib/hooks';
import { useMe, useSession } from '@/lib/session';

const KIND: Record<MemoryItem['kind'], string> = {
  preference: 'предпочтение',
  rule: 'правило',
  fact: 'факт',
};

export default function SettingsPage() {
  return (
    <div className="page" style={{ maxWidth: 760 }}>
      <div className="page-head">
        <div>
          <h1>Настройки</h1>
        </div>
      </div>
      <ProfileForm />
      <GoalForm />
      <AgentForm />
      <MemoryCard />
      <AccountCard />
    </div>
  );
}

function useSaver() {
  const { setMe } = useSession();
  const toast = useToast();
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  async function save(patch: PatchMe, msg: string) {
    setBusy(true);
    try {
      setMe(await api.updateMe(patch));
      setError(null);
      toast(msg);
    } catch (e) {
      setError(errorText(e));
    } finally {
      setBusy(false);
    }
  }
  return { save, error, busy };
}

function ProfileForm() {
  const me = useMe();
  const { save, error, busy } = useSaver();
  const [tz, setTz] = useState(me.timezone);
  function submit(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const f = new FormData(e.currentTarget);
    void save(
      {
        displayName: String(f.get('name') ?? '').trim() || null,
        weightUnit: f.get('unit') as Me['weightUnit'],
        timezone: tz,
      },
      'Профиль сохранён',
    );
  }
  return (
    <form className="card form" onSubmit={submit} id="profile">
      <h2>Профиль</h2>
      <div className="grid g-2">
        <label className="field">
          <span>Имя</span>
          <input
            className="input"
            id="pf-name"
            name="name"
            defaultValue={me.displayName ?? ''}
            maxLength={80}
          />
        </label>
        <label className="field">
          <span>Единицы</span>
          <select className="input" id="pf-unit" name="unit" defaultValue={me.weightUnit}>
            <option value="kg">Килограммы</option>
            <option value="lb">Фунты</option>
          </select>
        </label>
        <label className="field">
          <span>Часовой пояс</span>
          <TimezoneSelect id="pf-tz" value={tz} onChange={setTz} />
          <small>Определяет, к какому дню относится измерение.</small>
        </label>
      </div>
      {error && <span className="err-text">{error}</span>}
      <div>
        <button className="btn primary" type="submit" disabled={busy}>
          Сохранить профиль
        </button>
      </div>
    </form>
  );
}

function GoalForm() {
  const me = useMe();
  const u = me.weightUnit;
  const toast = useToast();
  const goal = useLoad(() => api.activeGoal(), []);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const g = goal.data?.goal ?? null;

  async function submit(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const f = new FormData(e.currentTarget);
    const t = parseWeight(String(f.get('target') ?? ''), u);
    if ('error' in t) return setError(`Цель: ${t.error}`);
    const startRaw = String(f.get('start') ?? '').trim();
    const s = startRaw ? parseWeight(startRaw, u) : null;
    if (s && 'error' in s) return setError(`Старт: ${s.error}`);
    const date = String(f.get('date') ?? '') || me.today;
    setBusy(true);
    try {
      await api.setGoal({
        targetWeightG: t.g,
        ...(s ? { startWeightG: s.g } : {}),
        startDate: date,
      });
      setError(null);
      toast('Цель сохранена');
      await goal.reload();
    } catch (err) {
      setError(errorText(err));
    } finally {
      setBusy(false);
    }
  }
  async function clear() {
    setBusy(true);
    try {
      await api.clearGoal();
      toast('Цель убрана');
      await goal.reload();
    } catch (err) {
      setError(errorText(err));
    } finally {
      setBusy(false);
    }
  }
  return (
    <form className="card form" onSubmit={submit} noValidate id="goal" key={g?.id ?? 'none'}>
      <h2>Цель</h2>
      {goal.error && <ErrorState text={goal.error} retry={() => void goal.reload()} />}
      {goal.loading && !goal.data ? (
        <Loading lines={2} />
      ) : (
        <>
          <div className="grid g-2">
            <label className="field">
              <span>Целевой вес, {unitLabel(u)}</span>
              <input
                className="input num"
                id="gl-target"
                name="target"
                inputMode="decimal"
                defaultValue={g ? num(g.targetWeightG, u) : ''}
              />
            </label>
            <label className="field">
              <span>Стартовый вес, {unitLabel(u)}</span>
              <input
                className="input num"
                id="gl-start"
                name="start"
                inputMode="decimal"
                defaultValue={g ? num(g.startWeightG, u) : ''}
                placeholder="последнее утреннее"
              />
            </label>
            <label className="field">
              <span>Дата старта</span>
              <input
                className="input"
                type="date"
                id="gl-date"
                name="date"
                defaultValue={g?.startDate ?? me.today}
                max={me.today}
              />
            </label>
          </div>
          <small className="muted">
            Направление (снижение, набор или удержание в коридоре ±1 кг) определяется по стартовому
            и целевому весу. Прежняя цель сохраняется в истории.
          </small>
          {error && <span className="err-text">{error}</span>}
          <div className="row">
            <button className="btn primary" type="submit" disabled={busy}>
              {g ? 'Сохранить новую цель' : 'Поставить цель'}
            </button>
            {g && (
              <button
                className="btn ghost danger"
                type="button"
                onClick={() => void clear()}
                disabled={busy}
              >
                Убрать цель
              </button>
            )}
          </div>
        </>
      )}
    </form>
  );
}

function AgentForm() {
  const me = useMe();
  const { save, error, busy } = useSaver();
  const p = me.preferences;
  function submit(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const f = new FormData(e.currentTarget);
    void save(
      {
        preferences: {
          language: f.get('language') as Me['preferences']['language'],
          reportFormat: f.get('reportFormat') as Me['preferences']['reportFormat'],
          agentTone: f.get('agentTone') as Me['preferences']['agentTone'],
          memoryEnabled: f.get('memoryEnabled') === 'on',
        },
      },
      'Настройки помощника сохранены',
    );
  }
  return (
    <form className="card form" onSubmit={submit} id="agent">
      <h2>AI-помощник</h2>
      <div className="grid g-2">
        <label className="field">
          <span>Язык ответов</span>
          <select className="input" id="ag-lang" name="language" defaultValue={p.language}>
            <option value="ru">Русский</option>
            <option value="en">English</option>
            <option value="hy">Հայերեն</option>
          </select>
        </label>
        <label className="field">
          <span>Формат отчёта</span>
          <select
            className="input"
            id="ag-report"
            name="reportFormat"
            defaultValue={p.reportFormat}
          >
            <option value="brief">Кратко</option>
            <option value="standard">Обычно</option>
            <option value="detailed">Подробно</option>
          </select>
        </label>
        <label className="field">
          <span>Тон</span>
          <select className="input" id="ag-tone" name="agentTone" defaultValue={p.agentTone}>
            <option value="neutral">Нейтральный</option>
            <option value="supportive">Поддерживающий</option>
            <option value="concise">Максимально коротко</option>
          </select>
        </label>
        <label className="field" style={{ flexDirection: 'row', alignItems: 'center', gap: 10 }}>
          <input
            type="checkbox"
            id="ag-memory"
            name="memoryEnabled"
            defaultChecked={p.memoryEnabled}
          />
          <span>Разрешить помощнику запоминать предпочтения</span>
        </label>
      </div>
      {error && <span className="err-text">{error}</span>}
      <div>
        <button className="btn primary" type="submit" disabled={busy}>
          Сохранить
        </button>
      </div>
    </form>
  );
}

function MemoryCard() {
  const toast = useToast();
  const mem = useLoad(() => api.memory(), []);
  const [editId, setEditId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const items = mem.data?.items ?? [];

  async function run(fn: () => Promise<unknown>, msg: string) {
    try {
      await fn();
      setError(null);
      setEditId(null);
      toast(msg);
      await mem.reload();
    } catch (e) {
      setError(errorText(e));
    }
  }
  return (
    <div className="card" id="memory">
      <div className="card-head">
        <h2>Память помощника</h2>
        <span className="chip">{items.length}</span>
      </div>
      <p className="small muted">
        Предпочтения и факты, которые помощник учитывает в ответах. Вес и цели он берёт только из
        дневника — память не может их изменить.
      </p>
      {mem.error && <ErrorState text={mem.error} retry={() => void mem.reload()} />}
      {mem.loading && !mem.data && <Loading lines={2} />}
      <div>
        {mem.data && !items.length && <p className="muted small">Память пуста.</p>}
        {items.map((m) =>
          editId === m.id ? (
            <form
              key={m.id}
              className="mem"
              onSubmit={(e) => {
                e.preventDefault();
                const content = String(new FormData(e.currentTarget).get('content') ?? '').trim();
                if (content) void run(() => api.updateMemory(m.id, { content }), 'Сохранено');
              }}
            >
              <input
                className="input"
                name="content"
                defaultValue={m.content}
                maxLength={500}
                aria-label="Текст"
              />
              <button className="btn sm primary" type="submit">
                Сохранить
              </button>
              <button className="btn sm ghost" type="button" onClick={() => setEditId(null)}>
                Отмена
              </button>
            </form>
          ) : (
            <div key={m.id} className="mem">
              <p>
                {m.content}{' '}
                <span className="small muted">
                  · {KIND[m.kind]}
                  {m.source === 'agent' ? ', записал помощник' : ''}
                </span>
              </p>
              <button className="btn ghost sm" onClick={() => setEditId(m.id)}>
                Изменить
              </button>
              <button
                className="btn ghost sm danger"
                onClick={() => void run(() => api.deleteMemory(m.id), 'Удалено из памяти')}
              >
                Удалить
              </button>
            </div>
          ),
        )}
      </div>
      {error && <span className="err-text">{error}</span>}
      <form
        className="row"
        onSubmit={(e) => {
          e.preventDefault();
          const form = e.currentTarget;
          const content = String(new FormData(form).get('content') ?? '').trim();
          if (content) void run(() => api.addMemory(content), 'Добавлено').then(() => form.reset());
        }}
      >
        <input
          className="input"
          id="mem-add"
          name="content"
          placeholder="Например: не ем после 19:00"
          maxLength={500}
          style={{ flex: 1, minWidth: 200 }}
        />
        <button className="btn" type="submit">
          Добавить
        </button>
      </form>
    </div>
  );
}

function AccountCard() {
  const { signOut } = useSession();
  const router = useRouter();
  const [confirm, setConfirm] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  async function del(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    if (
      String(new FormData(e.currentTarget).get('confirm') ?? '')
        .trim()
        .toUpperCase() !== 'УДАЛИТЬ'
    ) {
      return setError('Введите слово УДАЛИТЬ, чтобы подтвердить.');
    }
    setBusy(true);
    try {
      await api.deleteMe();
      await signOut();
      router.replace('/login');
    } catch (err) {
      setError(errorText(err));
      setBusy(false);
    }
  }
  return (
    <div className="card" id="account">
      <h2>Аккаунт</h2>
      <div className="row">
        <button className="btn" onClick={() => void signOut().then(() => router.replace('/login'))}>
          Выйти
        </button>
        <button className="btn danger" onClick={() => setConfirm(true)}>
          Удалить аккаунт
        </button>
      </div>
      {confirm && (
        <form
          className="confirm"
          style={{ flexDirection: 'column', alignItems: 'stretch' }}
          onSubmit={del}
        >
          <span>
            Будут удалены профиль, все измерения, цели, диалоги и память помощника. Это необратимо.
            Введите <b>УДАЛИТЬ</b> для подтверждения.
          </span>
          <div className="row">
            <input
              className={`input${error ? ' err' : ''}`}
              id="acc-confirm"
              name="confirm"
              autoComplete="off"
              style={{ flex: 1, minWidth: 160 }}
            />
            <button className="btn danger solid" type="submit" disabled={busy}>
              Удалить навсегда
            </button>
            <button
              className="btn"
              type="button"
              onClick={() => (setConfirm(false), setError(null))}
            >
              Отмена
            </button>
          </div>
          {error && <span className="err-text">{error}</span>}
        </form>
      )}
    </div>
  );
}
