/* Weight AI — interactive demo.
 * All numbers come from the real deterministic core (window.WeightCore = packages/core).
 * Data lives in this browser only. The chat agent is a local script that mimics the GPT
 * agent's tool calls; the product will call GPT through the OpenAI API on the server. */
'use strict';
const C = window.WeightCore;
const LS_KEY = 'weight-ai-demo-v1';
const AGENT_VERSION = 'v1.0';

/* ------------------------------------------------------------ state */

let state; // initialised at the bottom, once all helpers exist
const ui = {
  view: 'home',
  range: 90,
  editId: null,
  confirmDeleteId: null,
  editMemId: null,
  confirmAccount: false,
  typing: false,
  onboardStep: 1,
  addError: null,
};

function load() {
  try {
    const raw = localStorage.getItem(LS_KEY);
    return raw ? JSON.parse(raw) : null;
  } catch {
    return null;
  }
}
function save() {
  try {
    localStorage.setItem(LS_KEY, JSON.stringify(state));
  } catch {
    /* storage unavailable: demo keeps working in memory */
  }
}
const uid = () => Math.random().toString(36).slice(2, 10);

function detectTz() {
  try {
    const tz = Intl.DateTimeFormat().resolvedOptions().timeZone;
    return tz && C.isValidTimeZone(tz) ? tz : 'Europe/Moscow';
  } catch {
    return 'Europe/Moscow';
  }
}
function today() {
  return C.localDateInTimeZone(new Date(), state.profile?.tz || detectTz());
}
function nowTime() {
  const tz = state.profile?.tz || detectTz();
  return new Intl.DateTimeFormat('en-GB', {
    timeZone: tz,
    hour: '2-digit',
    minute: '2-digit',
    hour12: false,
  }).format(new Date());
}

function seedState() {
  const tz = detectTz();
  const t = C.localDateInTimeZone(new Date(), tz);
  let r = 11;
  const rnd = () => ((r = (r * 16807) % 2147483647), r / 2147483647);
  const span = 84;
  const start = C.addDays(t, -span);
  const entries = [];
  for (let i = 0; i < span; i++) {
    const d = C.addDays(start, i);
    const skip = rnd() < 0.17;
    if (skip && i > 0 && i < span - 1) continue;
    const trend = 86400 - 72 * Math.min(i, 56) - 38 * Math.max(0, i - 56);
    const noise = (rnd() - 0.5) * 700;
    const g = Math.round((trend + noise) / 100) * 100;
    const mm = String(Math.floor(rnd() * 50)).padStart(2, '0');
    entries.push({
      id: uid(),
      measuredOn: d,
      time: `07:${mm}`,
      weightG: g,
      note: '',
      source: 'manual',
    });
    if (rnd() < 0.08) {
      entries.push({
        id: uid(),
        measuredOn: d,
        time: '21:30',
        weightG: g + 900,
        note: 'вечером',
        source: 'manual',
      });
    }
  }
  return {
    demo: true,
    signedIn: true,
    profile: { name: 'Анна', email: 'anna@example.com', unit: 'kg', tz, reportFormat: 'short' },
    goal: { startWeightG: 86400, targetWeightG: 78000, startDate: start },
    entries,
    memory: [
      { id: uid(), text: 'Взвешивается утром, сразу после пробуждения.' },
      { id: uid(), text: 'Предпочитает короткие ответы без лишних советов.' },
      { id: uid(), text: 'Еженедельный отчёт — по воскресеньям.' },
    ],
    chat: [
      { id: uid(), role: 'user', text: 'Сколько мне осталось до цели?' },
      {
        id: uid(),
        role: 'bot',
        tools: [{ name: 'calculate_weight_analytics' }],
        text: null, // filled from live analytics on first render
        live: 'goal',
      },
    ],
    pending: null,
  };
}

/* ------------------------------------------------------------ analytics */

function coreEntries() {
  return state.entries.map((e) => ({
    id: e.id,
    measuredOn: e.measuredOn,
    measuredAt: `${e.measuredOn}T${e.time || '12:00'}:00Z`,
    weightG: e.weightG,
  }));
}
function summary() {
  return C.computeSummary(coreEntries(), state.goal, today());
}
function series() {
  return C.toDailySeries(coreEntries(), today());
}

/* ------------------------------------------------------------ formatting */

const unit = () => state.profile?.unit || 'kg';
const unitLabel = () => (unit() === 'kg' ? 'кг' : 'lb');
const nf1 = new Intl.NumberFormat('ru-RU', { minimumFractionDigits: 1, maximumFractionDigits: 1 });
function w(g) {
  return `${nf1.format(C.fromGrams(g, unit(), 1))} ${unitLabel()}`;
}
function wNum(g) {
  return nf1.format(C.fromGrams(g, unit(), 1));
}
function delta(g) {
  const v = C.fromGrams(Math.abs(g), unit(), 1);
  if (v === 0) return `0,0 ${unitLabel()}`;
  return `${g < 0 ? '−' : '+'}${nf1.format(v)} ${unitLabel()}`;
}
function perWeek(gPerDay) {
  return `${delta(Math.round(gPerDay * 7))}/нед`;
}
const MONTHS = ['янв', 'фев', 'мар', 'апр', 'мая', 'июн', 'июл', 'авг', 'сен', 'окт', 'ноя', 'дек'];
const MONTHS_FULL = [
  'Январь',
  'Февраль',
  'Март',
  'Апрель',
  'Май',
  'Июнь',
  'Июль',
  'Август',
  'Сентябрь',
  'Октябрь',
  'Ноябрь',
  'Декабрь',
];
function dShort(d) {
  const [, m, day] = d.split('-');
  return `${Number(day)} ${MONTHS[Number(m) - 1]}`;
}
function dLong(d) {
  const [y] = d.split('-');
  return `${dShort(d)} ${y}`;
}
function dRel(d) {
  const diff = C.daysBetween(d, today());
  if (diff === 0) return 'сегодня';
  if (diff === 1) return 'вчера';
  if (diff === 2) return 'позавчера';
  return dShort(d);
}
function plural(n, one, few, many) {
  const a = Math.abs(n) % 100;
  const b = a % 10;
  if (a > 10 && a < 20) return many;
  if (b > 1 && b < 5) return few;
  if (b === 1) return one;
  return many;
}
const days = (n) => `${n} ${plural(n, 'день', 'дня', 'дней')}`;
const meas = (n) => `${n} ${plural(n, 'измерение', 'измерения', 'измерений')}`;
function esc(s) {
  return String(s).replace(
    /[&<>"']/g,
    (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c],
  );
}

const PACE = {
  accelerating: ['Ускоряется', 'accent'],
  slowing: ['Замедляется', 'warn'],
  stable: ['Стабильно', 'good'],
  reversed: ['Сменил направление', 'bad'],
  insufficient_data: ['Мало данных', ''],
};
function forecastText(f) {
  switch (f.status) {
    case 'ok':
      return null;
    case 'no_goal':
      return 'Цель не задана.';
    case 'maintain_goal':
      return 'Цель — удержание веса; дата достижения не считается.';
    case 'achieved':
      return 'Цель уже достигнута по последнему измерению.';
    case 'insufficient_data':
      return 'Нужно минимум 5 измерений за последние 28 дней, охватывающих 10+ дней.';
    case 'no_trend':
      return 'Вес почти не меняется — надёжного тренда нет.';
    case 'moving_away':
      return 'Последний тренд направлен от цели.';
    case 'too_far':
      return 'При текущем темпе цель дальше чем через 2 года.';
    default:
      return f.reason;
  }
}

/* ------------------------------------------------------------ icons */

const ICONS = {
  home: '<path d="M3 10.5 12 3l9 7.5V20a1 1 0 0 1-1 1h-5v-6H9v6H4a1 1 0 0 1-1-1z"/>',
  add: '<circle cx="12" cy="12" r="9"/><path d="M12 8v8M8 12h8"/>',
  history: '<path d="M4 6h16M4 12h16M4 18h10"/>',
  chat: '<path d="M4 5h16v11H9l-5 4z"/>',
  settings:
    '<circle cx="12" cy="12" r="3"/><path d="M12 2v3M12 19v3M2 12h3M19 12h3M4.9 4.9 7 7M17 17l2.1 2.1M4.9 19.1 7 17M17 7l2.1-2.1"/>',
};
const icon = (k) =>
  `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${ICONS[k]}</svg>`;
const NAV = [
  ['home', 'Главная'],
  ['add', 'Записать'],
  ['history', 'История'],
  ['chat', 'Чат'],
  ['settings', 'Настройки'],
];

/* ------------------------------------------------------------ views */

function shell(content) {
  const nav = NAV.map(
    ([k, label]) =>
      `<button class="nav-btn" data-nav="${k}" ${ui.view === k ? 'aria-current="page"' : ''}>${icon(k)}<span>${label}</span></button>`,
  ).join('');
  return `<div class="shell">
    <aside class="side">
      <div class="brand"><div class="brand-mark">W</div><div class="brand-name">Weight AI</div></div>
      ${nav}
      <div class="side-foot small muted">${esc(state.profile.name)}<br>${esc(state.profile.email)}</div>
    </aside>
    <main class="main">${content}</main>
    <nav class="tabbar" aria-label="Разделы">${nav}</nav>
  </div>`;
}

function demoBanner() {
  return state.demo
    ? `<div class="banner"><b>Демо-данные.</b><span>Это пример профиля за 12 недель. Всё хранится только в этом браузере.</span>
       <button class="btn sm" data-act="start-clean" style="margin-left:auto">Начать со своих данных</button></div>`
    : '';
}

function homeView() {
  const s = summary();
  const hello = greeting();
  const head = `<div class="page-head"><div><span class="label">${dLong(s.asOf)}</span><h1>${hello}, ${esc(state.profile.name)}</h1></div>
    <button class="btn primary" data-nav="add">${icon('add').replace('<svg', '<svg width="18" height="18"')} Записать вес</button></div>`;
  if (!s.latest) {
    return `<div class="page">${head}${demoBanner()}<div class="card"><h2>Пока нет измерений</h2>
      <p class="muted">Запишите первый утренний вес — здесь появятся график, средние за 7 и 30 дней и прогноз.</p>
      <div class="row"><button class="btn primary" data-nav="add">Записать вес</button><button class="btn" data-nav="chat">Написать в чат</button></div></div></div>`;
  }
  const cp = s.changeSincePrevious;
  const cpChip = cp
    ? `<span class="chip ${cp.deltaG < 0 ? 'good' : cp.deltaG > 0 ? 'warn' : ''}">${delta(cp.deltaG)} к ${dRel(s.previous.date)}</span>`
    : '';
  const latestEntry = state.entries.find((e) => e.id === s.latest.entryId);
  const hero = `<div class="card">
      <span class="label">Последнее утреннее</span>
      <div class="readout"><span class="big">${wNum(s.latest.weightG)}</span><span class="unit">${unitLabel()}</span></div>
      <div class="hero-row">${cpChip}<span class="chip">${dRel(s.latest.date)}${latestEntry?.time ? ', ' + latestEntry.time : ''}</span>
      ${s.latest.entryCount > 1 ? `<span class="chip">${s.latest.entryCount} записи за день — учтена первая</span>` : ''}</div>
      <form class="quick" id="quick-form" novalidate>
        <label class="field"><span>${s.latest.date === s.asOf ? 'Ещё одно измерение сегодня' : 'Сегодня ещё не взвешивались'}</span>
        <div class="row"><input class="input num${ui.addError ? ' err' : ''}" id="quick-weight" name="weight" inputmode="decimal" placeholder="${wNum(s.latest.weightG)}" autocomplete="off" aria-label="Вес, ${unitLabel()}">
        <button class="btn primary" type="submit">Записать</button></div></label>
        ${ui.addError ? `<span class="err-text">${esc(ui.addError)}</span>` : ''}
      </form>
    </div>`;
  const goal = goalCard(s);
  const a7 = s.averages.last7;
  const p7 = s.averages.prev7;
  const a30 = s.averages.last30;
  const avgDiff = a7.avgG !== null && p7.avgG !== null ? a7.avgG - p7.avgG : null;
  const pace = s.pace;
  const [paceLabel, paceTone] = PACE[pace.classification];
  const base = s.changeFromBaseline;
  const tiles = `<div class="grid g-4">
    <div class="card stat"><span class="label">Среднее, 7 дней</span><span class="v">${a7.avgG !== null ? w(Math.round(a7.avgG)) : '—'}</span>
      <span class="sub">${meas(a7.count)}${avgDiff !== null ? ` · ${delta(Math.round(avgDiff))} к прошлой неделе` : ''}</span></div>
    <div class="card stat"><span class="label">Среднее, 30 дней</span><span class="v">${a30.avgG !== null ? w(Math.round(a30.avgG)) : '—'}</span>
      <span class="sub">${meas(a30.count)} из 30 дней</span></div>
    <div class="card stat"><span class="label">Темп, 14 дней</span><span class="v">${pace.recent ? perWeek(pace.recent.slopeGPerDay) : '—'}</span>
      <span class="sub"><span class="chip ${paceTone}">${paceLabel}</span>${pace.previous ? ` до этого ${perWeek(pace.previous.slopeGPerDay)}` : ''}</span></div>
    <div class="card stat"><span class="label">С начала цели</span><span class="v">${base ? delta(base.deltaG) : '—'}</span>
      <span class="sub">${base ? `за ${days(base.days)}${base.ratePerWeekG !== null ? ` · ${delta(base.ratePerWeekG)}/нед` : ''}` : ''}</span></div>
  </div>`;
  const chart = `<div class="card">
    <div class="card-head"><h2>Вес по утрам</h2>
      <div class="seg" role="group" aria-label="Период">${[30, 90, 0]
        .map(
          (n) =>
            `<button data-range="${n}" aria-pressed="${ui.range === n}">${n ? n + ' дн' : 'Всё'}</button>`,
        )
        .join('')}</div></div>
    <div class="chart-wrap" id="chart"></div>
    <div class="legend"><span><i style="background:var(--chart-pt)"></i>утреннее измерение</span><span><i style="background:var(--accent)"></i>среднее за 7 дней</span>
      ${state.goal ? '<span><i style="background:var(--good)"></i>цель</span>' : ''}${s.forecast.status === 'ok' ? '<span><i style="background:var(--accent);opacity:.35"></i>прогноз, 80 %</span>' : ''}</div>
  </div>`;
  return `<div class="page">${head}${demoBanner()}<div class="grid g-hero">${hero}${goal}</div>${tiles}${chart}
    <p class="disclaimer">Weight AI не является медицинским инструментом. Изменение веса на весах не говорит напрямую о жире, воде или мышцах; по вопросам здоровья обращайтесь к врачу.</p></div>`;
}

function greeting() {
  const h = Number(nowTime().slice(0, 2));
  if (h < 5) return 'Доброй ночи';
  if (h < 12) return 'Доброе утро';
  if (h < 18) return 'Добрый день';
  return 'Добрый вечер';
}

function goalCard(s) {
  if (!state.goal) {
    return `<div class="card"><span class="label">Цель</span><p class="muted">Цель не задана. Задайте целевой вес, чтобы видеть прогресс и прогноз.</p>
      <div><button class="btn" data-nav="settings">Задать цель</button></div></div>`;
  }
  const g = s.goal;
  const f = s.forecast;
  const pct = g.progressPct === null ? null : Math.max(0, Math.min(100, g.progressPct));
  const statusChip = {
    in_progress: ['В процессе', 'accent'],
    achieved: ['Достигнута', 'good'],
    exceeded: ['Перевыполнена', 'good'],
    within_range: ['В коридоре', 'good'],
    outside_range: ['Вне коридора', 'warn'],
    no_data: ['Нет данных', ''],
  }[g.status];
  const dirWord = { lose: 'снижение', gain: 'набор', maintain: 'удержание' }[g.direction];
  let fc;
  if (f.status === 'ok') {
    const rng = f.range
      ? `80 % интервал: ${dShort(f.range.earliest)} — ${f.range.latest ? dShort(f.range.latest) : 'позже 2 лет'}`
      : '';
    fc = `<div><span class="label">Прогноз</span><p><span class="num" style="font-size:1.15rem">≈ ${dLong(f.etaDate)}</span> <span class="muted">через ${days(f.etaDays)}</span></p>
      <p class="small muted">${rng}${rng ? ' · ' : ''}тренд ${perWeek(f.trend.slopeGPerDay)} по ${f.trend.points} дням</p></div>`;
  } else {
    fc = `<div><span class="label">Прогноз</span><p class="small muted">${forecastText(f)}</p></div>`;
  }
  return `<div class="card">
    <div class="card-head"><span class="label">Цель · ${dirWord}</span><span class="chip ${statusChip[1]}">${statusChip[0]}</span></div>
    <div class="readout"><span class="num" style="font-size:1.6rem">${w(g.targetWeightG)}</span>
      ${g.remainingG !== null ? `<span class="muted">осталось ${w(Math.abs(g.remainingG))}</span>` : ''}</div>
    ${
      pct !== null
        ? `<div class="bar" role="progressbar" aria-valuenow="${Math.round(pct)}" aria-valuemin="0" aria-valuemax="100"><span style="width:${pct}%"></span></div>
    <div class="bar-ends"><span class="num">${w(g.startWeightG)}</span><span class="num">${Math.round(g.progressPct)} %</span><span class="num">${w(g.targetWeightG)}</span></div>`
        : ''
    }
    ${fc}
  </div>`;
}

/* -------- chart (hand-drawn SVG, one x scale in epoch days, one y scale in grams) */

let chartModel = null;
function drawChart() {
  const host = document.getElementById('chart');
  if (!host) return;
  const s = summary();
  const all = series();
  const asOf = s.asOf;
  const from = ui.range ? C.addDays(asOf, -(ui.range - 1)) : all[0]?.date;
  const pts = all.filter((p) => p.date >= from);
  if (pts.length < 2) {
    host.innerHTML =
      '<p class="muted" style="padding:40px 0;text-align:center">Нужно минимум два дня измерений, чтобы построить график.</p>';
    return;
  }
  const W = Math.max(300, host.clientWidth);
  const H = W < 520 ? 230 : 280;
  const pl = 46,
    pr = 14,
    pt = 12,
    pb = 26;
  const x0 = C.toEpochDay(pts[0].date);
  const today0 = C.toEpochDay(asOf);
  const f = s.forecast;
  let xEnd = today0;
  const spanDays = today0 - x0;
  const fcShow = f.status === 'ok' && state.goal;
  if (fcShow)
    xEnd = Math.min(
      C.toEpochDay(f.range?.latest || f.etaDate),
      today0 + Math.max(14, Math.round(spanDays * 0.45)),
    );
  let lo = Math.min(...pts.map((p) => p.weightG));
  let hi = Math.max(...pts.map((p) => p.weightG));
  const target = state.goal?.targetWeightG;
  if (target && (fcShow || Math.abs(target - lo) < 3000 || Math.abs(target - hi) < 3000)) {
    lo = Math.min(lo, target);
    hi = Math.max(hi, target);
  }
  const padG = Math.max(300, (hi - lo) * 0.08);
  lo -= padG;
  hi += padG;
  const steps = [100, 200, 500, 1000, 2000, 5000, 10000];
  const step = steps.find((st) => (hi - lo) / st <= 5) || 20000;
  const yMin = Math.floor(lo / step) * step;
  const yMax = Math.ceil(hi / step) * step;
  const X = (day) => pl + ((day - x0) / Math.max(1, xEnd - x0)) * (W - pl - pr);
  const Y = (g) => pt + (1 - (g - yMin) / (yMax - yMin)) * (H - pt - pb);

  let svg = `<svg viewBox="0 0 ${W} ${H}" width="${W}" height="${H}" role="img" aria-label="График веса">`;
  svg += `<defs><clipPath id="plot"><rect x="${pl}" y="${pt}" width="${W - pl - pr}" height="${H - pt - pb}"/></clipPath></defs>`;
  for (let g = yMin; g <= yMax + 1; g += step) {
    svg += `<line x1="${pl}" x2="${W - pr}" y1="${Y(g)}" y2="${Y(g)}" stroke="var(--line)" stroke-width="1"/>`;
    svg += `<text x="${pl - 8}" y="${Y(g) + 4}" text-anchor="end">${nf1.format(C.fromGrams(g, unit(), 1))}</text>`;
  }
  const nTicks = W < 520 ? 3 : 5;
  for (let i = 0; i <= nTicks; i++) {
    const day = Math.round(x0 + ((xEnd - x0) * i) / nTicks);
    const anchor = i === 0 ? 'start' : i === nTicks ? 'end' : 'middle';
    svg += `<text x="${X(day)}" y="${H - 6}" text-anchor="${anchor}">${dShort(C.fromEpochDay(day))}</text>`;
  }
  // today marker
  svg += `<line x1="${X(today0)}" x2="${X(today0)}" y1="${pt}" y2="${H - pb}" stroke="var(--line)" stroke-dasharray="3 3"/>`;
  // goal line
  if (target && target >= yMin && target <= yMax) {
    svg += `<line x1="${pl}" x2="${W - pr}" y1="${Y(target)}" y2="${Y(target)}" stroke="var(--good)" stroke-width="1.5" stroke-dasharray="6 4"/>`;
    svg += `<text x="${W - pr - 4}" y="${Y(target) - 6}" text-anchor="end" style="fill:var(--good)">цель ${wNum(target)}</text>`;
  }
  svg += '<g clip-path="url(#plot)">';
  // forecast band + line
  if (fcShow) {
    const tr = f.trend;
    const startG = tr.fittedAtEndG + tr.slopeGPerDay * C.daysBetween(tr.to, asOf);
    const eta = C.toEpochDay(f.etaDate);
    if (f.range) {
      const e1 = C.toEpochDay(f.range.earliest);
      const e2 = f.range.latest ? C.toEpochDay(f.range.latest) : xEnd + 400;
      svg += `<polygon points="${X(today0)},${Y(startG)} ${X(e1)},${Y(target)} ${X(e2)},${Y(target)}" fill="var(--accent)" fill-opacity="0.12" stroke="none"/>`;
    }
    svg += `<line x1="${X(today0)}" y1="${Y(startG)}" x2="${X(eta)}" y2="${Y(target)}" stroke="var(--accent)" stroke-width="2" stroke-dasharray="5 5"/>`;
  }
  // 7-day average line
  const avg = pts
    .map((p) => [p.date, C.windowAverage(all, p.date, 7).avgG])
    .filter(([, a]) => a !== null);
  svg += `<polyline fill="none" stroke="var(--accent)" stroke-width="2.5" stroke-linejoin="round" stroke-linecap="round" points="${avg
    .map(([d, a]) => `${X(C.toEpochDay(d)).toFixed(1)},${Y(a).toFixed(1)}`)
    .join(' ')}"/>`;
  // points
  const r = pts.length > 60 ? 2.6 : 3.4;
  for (const p of pts) {
    svg += `<circle cx="${X(C.toEpochDay(p.date)).toFixed(1)}" cy="${Y(p.weightG).toFixed(1)}" r="${r}" fill="var(--chart-pt)" fill-opacity="0.75"/>`;
  }
  const last = pts[pts.length - 1];
  svg += `<circle cx="${X(C.toEpochDay(last.date))}" cy="${Y(last.weightG)}" r="5.5" fill="var(--accent)" stroke="var(--surface)" stroke-width="2"/>`;
  svg +=
    '</g><circle id="hover-dot" r="5" fill="none" stroke="var(--accent)" stroke-width="2" visibility="hidden"/></svg>';
  host.innerHTML = svg + '<div class="tip" id="tip" hidden></div>';
  chartModel = {
    pts: pts.map((p) => ({
      ...p,
      x: X(C.toEpochDay(p.date)),
      y: Y(p.weightG),
      avg: C.windowAverage(all, p.date, 7),
    })),
    W,
  };
}

function onChartMove(ev) {
  const host = document.getElementById('chart');
  if (!host || !chartModel) return;
  const svg = host.querySelector('svg');
  const rect = svg.getBoundingClientRect();
  const x = ((ev.clientX - rect.left) / rect.width) * chartModel.W;
  let best = null;
  for (const p of chartModel.pts) if (!best || Math.abs(p.x - x) < Math.abs(best.x - x)) best = p;
  const tip = document.getElementById('tip');
  const dot = document.getElementById('hover-dot');
  if (!best) return;
  const k = rect.width / chartModel.W;
  tip.hidden = false;
  tip.style.left = `${Math.min(Math.max(best.x * k, 70), rect.width - 70)}px`;
  tip.style.top = `${best.y * k}px`;
  tip.textContent = `${dShort(best.date)}: ${w(best.weightG)}${best.avg.avgG !== null ? ` · ср. 7 дн ${w(Math.round(best.avg.avgG))}` : ''}`;
  dot.setAttribute('cx', best.x);
  dot.setAttribute('cy', best.y);
  dot.setAttribute('visibility', 'visible');
}
function onChartLeave() {
  const tip = document.getElementById('tip');
  const dot = document.getElementById('hover-dot');
  if (tip) tip.hidden = true;
  if (dot) dot.setAttribute('visibility', 'hidden');
}

/* -------- add */

function addView() {
  const s = summary();
  const last = s.latest;
  const defaultVal = last ? wNum(last.weightG) : '';
  return `<div class="page" style="max-width:560px">
    <div class="page-head"><div><span class="label">Новое измерение</span><h1>Записать вес</h1></div></div>
    <form class="card form" id="add-form" novalidate>
      <label class="field"><span>Вес, ${unitLabel()}</span>
        <div class="weight-input"><button type="button" class="btn" data-step="-1" aria-label="Меньше на 0,1">−</button>
        <input class="input${ui.addError ? ' err' : ''}" id="add-weight" name="weight" inputmode="decimal" autocomplete="off" value="${defaultVal}" aria-describedby="add-weight-help">
        <button type="button" class="btn" data-step="1" aria-label="Больше на 0,1">+</button></div>
        ${ui.addError ? `<span class="err-text">${esc(ui.addError)}</span>` : `<small id="add-weight-help">${last ? `Последнее: ${w(last.weightG)} (${dRel(last.date)})` : 'Допустимо 20–400 кг'}</small>`}
      </label>
      <div class="grid g-2">
        <label class="field"><span>Дата</span><input class="input" type="date" id="add-date" name="date" value="${today()}" max="${today()}"></label>
        <label class="field"><span>Время</span><input class="input" type="time" id="add-time" name="time" value="${nowTime()}"></label>
      </div>
      <label class="field"><span>Заметка <span class="muted">(необязательно)</span></span><input class="input" id="add-note" name="note" maxlength="200" placeholder="например: после тренировки"></label>
      <p class="small muted">В расчётах за день учитывается самое раннее измерение — утреннее. Остальные записи сохраняются в истории.</p>
      <div class="row"><button class="btn primary" type="submit">Сохранить</button><button class="btn ghost" type="button" data-nav="home">Отмена</button></div>
    </form></div>`;
}

function parseUserWeight(raw) {
  const v = Number(String(raw).replace(',', '.').trim());
  if (!raw || !Number.isFinite(v) || v <= 0) return { error: 'Введите число, например 78,4.' };
  const g = C.toGrams(v, unit());
  if (!C.isValidWeightG(g))
    return { error: `Вес должен быть от ${w(C.MIN_WEIGHT_G)} до ${w(C.MAX_WEIGHT_G)}.` };
  return { g };
}

/* -------- history */

function historyView() {
  if (!state.entries.length) {
    return `<div class="page"><div class="page-head"><div><h1>История</h1></div></div>
      <div class="card"><h2>История пуста</h2><p class="muted">Здесь будут все измерения с датой, временем и изменением к предыдущему дню.</p>
      <div><button class="btn primary" data-nav="add">Записать вес</button></div></div></div>`;
  }
  const ser = series();
  const morningIds = new Set(ser.map((p) => p.entryId));
  const prevByDate = new Map();
  ser.forEach((p, i) => prevByDate.set(p.date, i > 0 ? ser[i - 1] : null));
  const sorted = [...state.entries].sort((a, b) =>
    a.measuredOn === b.measuredOn
      ? (b.time || '').localeCompare(a.time || '')
      : a.measuredOn < b.measuredOn
        ? 1
        : -1,
  );
  let html = '';
  let month = '';
  for (const e of sorted) {
    const m = e.measuredOn.slice(0, 7);
    if (m !== month) {
      month = m;
      html += `<div class="month label">${MONTHS_FULL[Number(m.slice(5)) - 1]} ${m.slice(0, 4)}</div>`;
    }
    const isMorning = morningIds.has(e.id);
    const prev = prevByDate.get(e.measuredOn);
    const dlt = isMorning && prev ? e.weightG - prev.weightG : null;
    if (ui.editId === e.id) {
      html += `<form class="entry-edit form" id="edit-form" data-id="${e.id}" novalidate>
        <div class="grid g-2"><label class="field"><span>Вес, ${unitLabel()}</span><input class="input num" id="edit-weight" name="weight" inputmode="decimal" value="${wNum(e.weightG)}"></label>
        <label class="field"><span>Дата</span><input class="input" type="date" id="edit-date" name="date" value="${e.measuredOn}" max="${today()}"></label>
        <label class="field"><span>Время</span><input class="input" type="time" id="edit-time" name="time" value="${e.time || ''}"></label>
        <label class="field"><span>Заметка</span><input class="input" id="edit-note" name="note" value="${esc(e.note || '')}" maxlength="200"></label></div>
        ${ui.addError ? `<span class="err-text">${esc(ui.addError)}</span>` : ''}
        <div class="row"><button class="btn primary sm" type="submit">Сохранить</button><button class="btn ghost sm" type="button" data-act="cancel-edit">Отмена</button></div>
      </form>`;
      continue;
    }
    html += `<div class="entry${isMorning ? '' : ' secondary'}">
      <div class="d"><span>${dShort(e.measuredOn)}</span><span class="small muted num">${e.time || '—'}</span></div>
      <div style="min-width:0"><span class="w">${w(e.weightG)}</span>
        <div class="small muted">${isMorning ? '' : 'не утреннее — в расчёт не идёт'}${e.note ? (isMorning ? '' : ' · ') + esc(e.note) : ''}${e.source === 'chat' ? ' · через чат' : ''}</div></div>
      <span class="delta ${dlt > 0 ? 'up' : dlt < 0 ? 'down' : 'muted'}">${dlt !== null ? delta(dlt) : ''}</span>
      <div class="acts"><button class="btn ghost sm" data-act="edit" data-id="${e.id}">Изменить</button><button class="btn ghost sm danger" data-act="ask-delete" data-id="${e.id}" aria-label="Удалить запись за ${dShort(e.measuredOn)}">Удалить</button></div>
    </div>`;
    if (ui.confirmDeleteId === e.id) {
      html += `<div class="confirm"><span>Удалить ${w(e.weightG)} за ${dLong(e.measuredOn)}? Это нельзя отменить.</span>
        <span class="row"><button class="btn sm danger solid" data-act="delete" data-id="${e.id}">Удалить</button><button class="btn sm" data-act="cancel-delete">Отмена</button></span></div>`;
    }
  }
  return `<div class="page"><div class="page-head"><div><span class="label">${meas(state.entries.length)} · ${days(ser.length)} с измерениями</span><h1>История</h1></div>
    <button class="btn primary" data-nav="add">Записать вес</button></div>
    <div class="card"><div class="list">${html}</div></div></div>`;
}

/* -------- chat */

function chatView() {
  const msgs = state.chat
    .map((m) => {
      if (m.role === 'user')
        return `<div class="msg user"><div class="bubble">${esc(m.text)}</div></div>`;
      if (m.live && !m.text) {
        m.text = liveText(m.live);
        save();
      }
      const text = m.text;
      const tools = m.tools?.length
        ? `<div class="tools">${m.tools.map((t) => `<span class="tool${WRITE_TOOLS.has(t.name) ? ' write' : ''}">${t.name}${t.ok === false ? ' ✕' : ''}</span>`).join('')}</div>`
        : '';
      const confirm =
        m.confirm && state.pending && state.pending.msgId === m.id
          ? `<div class="row"><button class="btn sm danger solid" data-act="chat-confirm">Да, удалить</button><button class="btn sm" data-act="chat-cancel">Отмена</button></div>`
          : '';
      return `<div class="msg bot">${tools}<div class="bubble">${esc(text)}</div>${confirm}</div>`;
    })
    .join('');
  const sugg = [
    '78,6',
    'Вчера было 79,1',
    'Сколько осталось до цели?',
    'Отчёт за неделю',
    'Удали последнюю запись',
    'Запомни: я бегаю по средам',
    'Что ты обо мне помнишь?',
  ];
  return `<div class="page chat" style="max-width:760px">
    <div class="page-head"><div><span class="label">Агент · инструкции ${AGENT_VERSION}</span><h1>Чат</h1></div>
      <button class="btn sm" data-act="chat-clear">Новый диалог</button></div>
    <div class="banner"><b>Демо-агент.</b><span>Здесь отвечает локальный сценарий. В продукте — GPT через OpenAI API на сервере, с теми же инструментами: метки над ответом показывают, какие вызваны. Данные меняются по-настоящему.</span></div>
    <div class="msgs" id="msgs">${msgs}${ui.typing ? '<div class="typing">Агент печатает…</div>' : ''}</div>
    <div class="composer">
      <div class="suggest">${sugg.map((t) => `<button class="btn sm" data-say="${esc(t)}">${esc(t)}</button>`).join('')}</div>
      <form id="chat-form"><input class="input" id="chat-input" name="text" autocomplete="off" placeholder="Например: сегодня 78,4" maxlength="500" aria-label="Сообщение агенту">
      <button class="btn primary" type="submit">Отправить</button></form>
    </div></div>`;
}

/* -------- settings */

function settingsView() {
  const p = state.profile;
  const tzs = [
    ...new Set([
      p.tz,
      detectTz(),
      'Europe/Kaliningrad',
      'Europe/Moscow',
      'Europe/Samara',
      'Asia/Yekaterinburg',
      'Asia/Novosibirsk',
      'Asia/Vladivostok',
      'Europe/Berlin',
      'America/New_York',
      'UTC',
    ]),
  ];
  const g = state.goal;
  const mem = state.memory
    .map((m) =>
      ui.editMemId === m.id
        ? `<form class="mem" id="mem-edit-form" data-id="${m.id}"><input class="input" id="mem-edit" name="text" value="${esc(m.text)}" maxlength="300">
           <button class="btn sm primary" type="submit">Сохранить</button><button class="btn sm ghost" type="button" data-act="mem-cancel">Отмена</button></form>`
        : `<div class="mem"><p>${esc(m.text)}</p><button class="btn ghost sm" data-act="mem-edit" data-id="${m.id}">Изменить</button><button class="btn ghost sm danger" data-act="mem-delete" data-id="${m.id}">Удалить</button></div>`,
    )
    .join('');
  return `<div class="page" style="max-width:760px">
    <div class="page-head"><div><h1>Настройки</h1></div></div>
    <form class="card form" id="profile-form">
      <h2>Профиль</h2>
      <div class="grid g-2">
        <label class="field"><span>Имя</span><input class="input" id="pf-name" name="name" value="${esc(p.name)}" maxlength="60"></label>
        <label class="field"><span>Единицы</span><select class="input" id="pf-unit" name="unit"><option value="kg" ${p.unit === 'kg' ? 'selected' : ''}>Килограммы</option><option value="lb" ${p.unit === 'lb' ? 'selected' : ''}>Фунты</option></select></label>
        <label class="field"><span>Часовой пояс</span><select class="input" id="pf-tz" name="tz">${tzs.map((t) => `<option ${t === p.tz ? 'selected' : ''}>${t}</option>`).join('')}</select>
          <small>Определяет, к какому дню относится измерение.</small></label>
        <label class="field"><span>Формат отчёта</span><select class="input" id="pf-report" name="reportFormat"><option value="short" ${p.reportFormat === 'short' ? 'selected' : ''}>Кратко</option><option value="full" ${p.reportFormat === 'full' ? 'selected' : ''}>Подробно</option></select></label>
      </div>
      <div><button class="btn primary" type="submit">Сохранить профиль</button></div>
    </form>
    <form class="card form" id="goal-form" novalidate>
      <h2>Цель</h2>
      <div class="grid g-2">
        <label class="field"><span>Целевой вес, ${unitLabel()}</span><input class="input num" id="gl-target" name="target" inputmode="decimal" value="${g ? wNum(g.targetWeightG) : ''}"></label>
        <label class="field"><span>Стартовый вес, ${unitLabel()}</span><input class="input num" id="gl-start" name="start" inputmode="decimal" value="${g ? wNum(g.startWeightG) : summary().latest ? wNum(summary().latest.weightG) : ''}"></label>
        <label class="field"><span>Дата старта</span><input class="input" type="date" id="gl-date" name="date" value="${g ? g.startDate : today()}" max="${today()}"></label>
      </div>
      <small class="muted">Направление (снижение, набор или удержание в коридоре ±1 кг) определяется по стартовому и целевому весу.</small>
      ${ui.goalError ? `<span class="err-text">${esc(ui.goalError)}</span>` : ''}
      <div class="row"><button class="btn primary" type="submit">Сохранить цель</button>${g ? '<button class="btn ghost danger" type="button" data-act="goal-clear">Убрать цель</button>' : ''}</div>
    </form>
    <div class="card">
      <div class="card-head"><h2>Память агента</h2><span class="chip">${state.memory.length}</span></div>
      <p class="small muted">Устойчивые факты и предпочтения, которые агент учитывает в ответах. Вес и цели агент берёт только из базы — память не может их изменить.</p>
      <div>${mem || '<p class="muted small">Память пуста.</p>'}</div>
      <form class="row" id="mem-add-form"><input class="input" id="mem-add" name="text" placeholder="Добавить факт, например: не ем после 19:00" maxlength="300" style="flex:1;min-width:200px"><button class="btn" type="submit">Добавить</button></form>
    </div>
    <div class="card">
      <h2>Агент</h2>
      <dl class="kv"><dt>Версия инструкций</dt><dd>${AGENT_VERSION}</dd><dt>Модель</dt><dd>из OPENAI_MODEL на сервере</dd><dt>Инструменты</dt><dd>${TOOLS.length}</dd><dt>Лимит шагов на запрос</dt><dd>5</dd></dl>
      <div class="tools">${TOOLS.map((t) => `<span class="tool${WRITE_TOOLS.has(t) ? ' write' : ''}">${t}</span>`).join('')}</div>
    </div>
    <div class="card">
      <h2>Данные и аккаунт</h2>
      <div class="row"><button class="btn" data-act="reset-demo">Загрузить демо-данные</button><button class="btn" data-act="sign-out">Выйти</button>
        <button class="btn danger" data-act="ask-account">Удалить аккаунт</button></div>
      ${
        ui.confirmAccount
          ? `<form class="confirm" id="account-form" style="flex-direction:column;align-items:stretch">
        <span>Будут удалены профиль, все измерения, цели, диалоги и память агента. Это необратимо. Введите <b>УДАЛИТЬ</b> для подтверждения.</span>
        <div class="row"><input class="input" id="acc-confirm" name="confirm" autocomplete="off" style="flex:1;min-width:160px"><button class="btn danger solid" type="submit">Удалить навсегда</button><button class="btn" type="button" data-act="cancel-account">Отмена</button></div></form>`
          : ''
      }
    </div></div>`;
}

/* -------- auth & onboarding */

function loginView() {
  return `<div class="auth"><form class="card form" id="login-form" novalidate>
    <div class="brand" style="padding:0"><div class="brand-mark">W</div><div class="brand-name">Weight AI</div></div>
    <div><h1>Вход</h1><p class="muted">Дневник веса с графиками, прогнозом и AI-помощником.</p></div>
    <label class="field"><span>Email</span><input class="input" type="email" id="lg-email" name="email" autocomplete="email" value="anna@example.com"></label>
    <label class="field"><span>Пароль</span><input class="input" type="password" id="lg-pass" name="password" autocomplete="current-password" value="demo-password"></label>
    <button class="btn primary" type="submit">Войти</button>
    <button class="btn" type="button" data-act="register">Создать аккаунт</button>
    <p class="small muted">Демо: вход локальный, пароль нигде не хранится. В продукте — Supabase Auth.</p>
  </form></div>`;
}

function onboardingView() {
  const st = ui.onboardStep;
  const tz = detectTz();
  const steps = `<div class="steps">${[1, 2].map((i) => `<span class="${i <= st ? 'on' : ''}"></span>`).join('')}</div>`;
  if (st === 1) {
    return `<div class="auth"><form class="card form" id="onb1-form" novalidate>${steps}
      <div><span class="label">Шаг 1 из 2</span><h1>Профиль</h1></div>
      <label class="field"><span>Как к вам обращаться</span><input class="input" id="ob-name" name="name" maxlength="60" required></label>
      <label class="field"><span>Единицы</span><select class="input" id="ob-unit" name="unit"><option value="kg">Килограммы</option><option value="lb">Фунты</option></select></label>
      <label class="field"><span>Часовой пояс</span><input class="input" id="ob-tz" name="tz" value="${esc(tz)}"><small>Определён по устройству.</small></label>
      ${ui.addError ? `<span class="err-text">${esc(ui.addError)}</span>` : ''}
      <button class="btn primary" type="submit">Далее</button>
      <button class="btn ghost" type="button" data-act="reset-demo">Посмотреть на демо-данных</button>
    </form></div>`;
  }
  const u = state.profile.unit === 'kg' ? 'кг' : 'lb';
  return `<div class="auth"><form class="card form" id="onb2-form" novalidate>${steps}
    <div><span class="label">Шаг 2 из 2</span><h1>Вес и цель</h1></div>
    <label class="field"><span>Текущий вес, ${u}</span><input class="input num" id="ob-weight" name="weight" inputmode="decimal" required></label>
    <label class="field"><span>Целевой вес, ${u} <span class="muted">(можно позже)</span></span><input class="input num" id="ob-target" name="target" inputmode="decimal"></label>
    ${ui.addError ? `<span class="err-text">${esc(ui.addError)}</span>` : ''}
    <button class="btn primary" type="submit">Начать</button>
  </form></div>`;
}

/* ------------------------------------------------------------ agent (local script) */

const TOOLS = [
  'get_user_profile',
  'get_weight_history',
  'calculate_weight_analytics',
  'add_weight_entry',
  'update_weight_entry',
  'delete_weight_entry',
  'manage_goal',
  'get_agent_memory',
  'update_agent_memory',
  'generate_report',
];
const WRITE_TOOLS = new Set([
  'add_weight_entry',
  'update_weight_entry',
  'delete_weight_entry',
  'manage_goal',
  'update_agent_memory',
]);

function liveText(kind) {
  if (kind === 'goal') return goalAnswer();
  return '';
}

function goalAnswer() {
  const s = summary();
  if (!state.goal) return 'Цель пока не задана. Напишите, например: «поставь цель 75».';
  if (!s.latest)
    return `Цель — ${w(state.goal.targetWeightG)}. Измерений пока нет, запишите первый вес.`;
  const g = s.goal;
  const f = s.forecast;
  let t = `Последний утренний вес — ${w(s.latest.weightG)} (${dRel(s.latest.date)}). `;
  if (g.status === 'achieved' || g.status === 'exceeded')
    t += `Цель ${w(g.targetWeightG)} достигнута.`;
  else if (g.direction === 'maintain')
    t += `Цель — удерживать ${w(g.targetWeightG)} ±1 кг; сейчас ${g.status === 'within_range' ? 'в коридоре' : 'вне коридора'}.`;
  else
    t += `До цели ${w(g.targetWeightG)} осталось ${w(Math.abs(g.remainingG))}, пройдено ${Math.round(g.progressPct)} %.`;
  if (f.status === 'ok') {
    t += `\nПри текущем темпе (${perWeek(f.trend.slopeGPerDay)}) цель ожидается около ${dLong(f.etaDate)}`;
    if (f.range)
      t += `; с вероятностью 80 % — между ${dShort(f.range.earliest)} и ${f.range.latest ? dShort(f.range.latest) : '«позже 2 лет»'}`;
    t += '.';
  } else if (f.status !== 'achieved') t += `\n${forecastText(f)}`;
  return t;
}

function reportAnswer() {
  const s = summary();
  const a7 = s.averages.last7;
  const p7 = s.averages.prev7;
  const ser = series().filter((p) => p.date >= C.addDays(s.asOf, -6));
  if (!ser.length) return 'За последние 7 дней измерений нет — отчёт строить не из чего.';
  const min = Math.min(...ser.map((p) => p.weightG));
  const max = Math.max(...ser.map((p) => p.weightG));
  const diff = a7.avgG !== null && p7.avgG !== null ? a7.avgG - p7.avgG : null;
  const short = state.profile.reportFormat !== 'full';
  let t = `Отчёт за ${dShort(C.addDays(s.asOf, -6))} — ${dShort(s.asOf)}\n`;
  t += `• Среднее: ${w(Math.round(a7.avgG))} (${meas(a7.count)})`;
  if (diff !== null) t += `, ${delta(Math.round(diff))} к прошлой неделе`;
  t += '\n';
  if (!short) t += `• Диапазон: ${w(min)} — ${w(max)}\n`;
  if (s.pace.recent)
    t += `• Темп за 14 дней: ${perWeek(s.pace.recent.slopeGPerDay)} (${PACE[s.pace.classification][0].toLowerCase()})\n`;
  if (s.goal && s.goal.remainingG !== null && s.goal.direction !== 'maintain')
    t += `• До цели: ${w(Math.abs(s.goal.remainingG))}\n`;
  if (!short && s.forecast.status === 'ok') t += `• Прогноз: около ${dLong(s.forecast.etaDate)}\n`;
  if (!short)
    t += `• Среднее за 30 дней: ${s.averages.last30.avgG !== null ? w(Math.round(s.averages.last30.avgG)) : '—'} (${meas(s.averages.last30.count)})`;
  return t.trim();
}

// Splits a message into number-like tokens. "21.10 — 79" has a date and a weight; a lone
// "78.4" or "7,84" is a weight (possibly a typo the range check will catch).
function numberTokens(text) {
  return [...text.matchAll(/\d+(?:[.,/]\d+)*/g)].map((m) => m[0]);
}
function asDate(tok) {
  const m = tok.match(/^(\d{1,2})[./](\d{1,2})(?:[./](\d{2,4}))?$/);
  if (!m) return null;
  const y = m[3] ? (m[3].length === 2 ? '20' + m[3] : m[3]) : today().slice(0, 4);
  const d = `${y}-${m[2].padStart(2, '0')}-${m[1].padStart(2, '0')}`;
  return C.isValidLocalDate(d) ? d : null;
}
function parseDateFrom(text) {
  const t = text.toLowerCase();
  if (/позавчера/.test(t)) return C.addDays(today(), -2);
  if (/вчера/.test(t)) return C.addDays(today(), -1);
  const toks = numberTokens(t);
  if (toks.length >= 2) {
    const d = toks.map(asDate).find(Boolean);
    if (d) return d;
    if (toks.some((x) => /^\d{1,2}[./]\d{1,2}[./]/.test(x))) return 'invalid';
  }
  return today();
}
function parseNumberFrom(text) {
  const toks = numberTokens(text);
  const weightTok = toks.length >= 2 ? toks.find((x) => !asDate(x)) : toks[0];
  if (!weightTok || /[/]/.test(weightTok)) return null;
  const v = Number(weightTok.replace(',', '.'));
  if (!Number.isFinite(v)) return null;
  const u = /\b(lb|lbs)\b|фунт/i.test(text) ? 'lb' : /кг|kg|кило/i.test(text) ? 'kg' : unit();
  return { v, u };
}

function agentReply(text) {
  const t = text.toLowerCase().trim();
  const tools = [];
  const call = (name, ok = true) => tools.push({ name, ok });
  const out = (reply, extra = {}) => ({ text: reply, tools, ...extra });

  if (state.pending) {
    if (/^(да|удаляй|удали|подтверждаю|ок|ага)\b/.test(t)) return confirmPending();
    if (/^(нет|отмена|не надо|стоп)\b/.test(t)) {
      state.pending = null;
      return out('Хорошо, ничего не удаляю.');
    }
    state.pending = null;
  }

  if (/жир|здоров|болезн|диагноз|лекарств|таблет|врач/.test(t)) {
    return out(
      'Я помогаю вести дневник и считать статистику, но не даю медицинских оценок. По весам нельзя отличить потерю жира от воды или мышц. С вопросами о здоровье лучше обратиться к врачу.',
    );
  }

  if (/удал/.test(t)) {
    call('get_weight_history');
    const date = /последн/.test(t) ? null : parseDateFrom(t);
    let target;
    if (date && date !== 'invalid' && date !== today()) target = latestOn(date);
    else if (/сегодн/.test(t)) target = latestOn(today());
    else target = [...state.entries].sort(byDateTimeDesc)[0];
    if (!target)
      return out(
        date && date !== 'invalid'
          ? `За ${dLong(date)} записей нет.`
          : 'Записей пока нет — удалять нечего.',
      );
    const id = uid();
    state.pending = { kind: 'delete', entryId: target.id, msgId: id };
    return out(
      `Удалить запись ${w(target.weightG)} за ${dLong(target.measuredOn)}${target.time ? ', ' + target.time : ''}? Подтвердите — удаление необратимо.`,
      { id, confirm: true },
    );
  }

  if (/запомни/.test(t)) {
    const fact = text.replace(/^.*?запомни[,:]?\s*/i, '').trim();
    if (!fact) return out('Что именно запомнить? Напишите, например: «запомни: бегаю по средам».');
    if (/\d{2,3}([.,]\d)?\s*(кг|kg)/i.test(fact)) {
      return out(
        'Вес и цели я храню только в дневнике, а не в памяти. Если это измерение — просто напишите его, например «сегодня 78,4».',
      );
    }
    call('update_agent_memory');
    state.memory.push({ id: uid(), text: fact.charAt(0).toUpperCase() + fact.slice(1) });
    return out(`Запомнил: «${fact}». Посмотреть и удалить можно в Настройках → Память агента.`);
  }

  if (/помнишь|памят/.test(t)) {
    call('get_agent_memory');
    if (!state.memory.length) return out('В памяти пока ничего нет.');
    return out('Вот что я помню:\n' + state.memory.map((m) => '• ' + m.text).join('\n'));
  }

  if (/цел/.test(t) && /постав|установ|нов|смен|измени|хочу|сделай/.test(t)) {
    const n = parseNumberFrom(t);
    if (!n) return out('Какой целевой вес поставить? Например: «поставь цель 75 кг».');
    const g = C.toGrams(n.v, n.u);
    if (!C.isValidWeightG(g))
      return out(
        `${n.v} ${n.u === 'kg' ? 'кг' : 'lb'} вне допустимого диапазона 20–400 кг. Уточните значение.`,
      );
    call('calculate_weight_analytics');
    call('manage_goal');
    const s = summary();
    const start = s.latest?.weightG ?? g;
    state.goal = { startWeightG: start, targetWeightG: g, startDate: s.latest?.date ?? today() };
    const dir = C.goalDirection(state.goal);
    return out(
      `Новая цель — ${w(g)} (${{ lose: 'снижение', gain: 'набор', maintain: 'удержание' }[dir]}). Старт: ${w(start)}. ` +
        goalAnswer().split('\n').slice(1).join(' '),
    );
  }

  if (/исправ|ошиб|не .+,? а |поправ/.test(t)) {
    const n = parseNumberFrom(t.split(/ а |на /).pop() || t);
    const target = [...state.entries].sort(byDateTimeDesc)[0];
    if (!target) return out('Записей пока нет — исправлять нечего.');
    if (!n)
      return out(
        `Какое значение поставить вместо ${w(target.weightG)} за ${dLong(target.measuredOn)}?`,
      );
    const g = C.toGrams(n.v, n.u);
    if (!C.isValidWeightG(g))
      return out('Это значение вне допустимого диапазона 20–400 кг. Уточните.');
    call('get_weight_history');
    call('update_weight_entry');
    const old = target.weightG;
    target.weightG = g;
    return out(`Исправил: ${dLong(target.measuredOn)} было ${w(old)}, теперь ${w(g)}.`);
  }

  if (/отч[её]т|итог|за недел/.test(t)) {
    call('calculate_weight_analytics');
    call('generate_report');
    return out(reportAnswer());
  }

  if (/прогноз|когда|остал|прогресс|цел/.test(t)) {
    call('calculate_weight_analytics');
    return out(goalAnswer());
  }

  if (/истори|последн|записи/.test(t)) {
    call('get_weight_history');
    const last = series().slice(-7).reverse();
    if (!last.length) return out('Измерений пока нет.');
    return out(
      'Последние утренние измерения:\n' +
        last.map((p) => `• ${dShort(p.date)} — ${w(p.weightG)}`).join('\n'),
    );
  }

  if (/средн/.test(t)) {
    call('calculate_weight_analytics');
    const s = summary();
    const a7 = s.averages.last7;
    const a30 = s.averages.last30;
    return out(
      `Среднее за 7 дней: ${a7.avgG !== null ? w(Math.round(a7.avgG)) : '—'} (${meas(a7.count)}).\nСреднее за 30 дней: ${a30.avgG !== null ? w(Math.round(a30.avgG)) : '—'} (${meas(a30.count)}). Пропущенные дни не заполняются.`,
    );
  }

  const n = parseNumberFrom(t);
  if (n) {
    const date = parseDateFrom(t);
    if (date === 'invalid')
      return out('Не понял дату. Напишите её как 21.10 или словами: «вчера», «позавчера».');
    if (date > today()) return out('Это дата в будущем. Уточните, за какой день записать вес.');
    let g;
    try {
      g = C.toGrams(n.v, n.u);
    } catch {
      g = 0;
    }
    if (!C.isValidWeightG(g)) {
      return out(
        `${String(n.v).replace('.', ',')} ${n.u === 'kg' ? 'кг' : 'lb'} — вне допустимого диапазона 20–400 кг. Похоже на опечатку, уточните значение.`,
      );
    }
    const before = summary();
    if (before.latest && Math.abs(g - before.latest.weightG) > 5000 && !/точно/.test(t)) {
      call('get_weight_history');
      return out(
        `${w(g)} отличается от последнего значения ${w(before.latest.weightG)} больше чем на 5 кг. Это точно? Если да — напишите «точно ${wNum(g)}».`,
      );
    }
    call('add_weight_entry');
    const isToday = date === today();
    state.entries.push({
      id: uid(),
      measuredOn: date,
      time: isToday ? nowTime() : '08:00',
      weightG: g,
      note: '',
      source: 'chat',
    });
    call('calculate_weight_analytics');
    const s = summary();
    const newId = state.entries[state.entries.length - 1].id;
    const ser = series();
    const idx = ser.findIndex((p) => p.date === date);
    let reply = `Записал ${w(g)} за ${dRel(date)}.`;
    if (ser[idx]?.entryId !== newId) {
      reply += ` Это не первое измерение за день — в расчётах остаётся утреннее ${w(ser[idx].weightG)}.`;
    } else if (idx > 0) {
      reply += `\nК ${dRel(ser[idx - 1].date)}: ${delta(g - ser[idx - 1].weightG)}.`;
    }
    if (s.averages.last7.avgG !== null)
      reply += ` Среднее за 7 дней — ${w(Math.round(s.averages.last7.avgG))}.`;
    if (
      s.goal &&
      s.goal.remainingG !== null &&
      s.goal.direction !== 'maintain' &&
      s.goal.status === 'in_progress'
    )
      reply += ` До цели ${w(Math.abs(s.goal.remainingG))}.`;
    if (s.goal && (s.goal.status === 'achieved' || s.goal.status === 'exceeded'))
      reply += ' Цель достигнута!';
    return out(reply);
  }

  call('get_user_profile');
  return out(
    'Я могу записать вес («сегодня 78,4», «вчера 79,1», «21.10 — 79»), исправить или удалить запись, показать прогресс и прогноз, сделать отчёт за неделю, поставить цель и запомнить ваши предпочтения.',
  );
}

function latestOn(date) {
  return state.entries.filter((e) => e.measuredOn === date).sort(byDateTimeDesc)[0];
}
function byDateTimeDesc(a, b) {
  if (a.measuredOn !== b.measuredOn) return a.measuredOn < b.measuredOn ? 1 : -1;
  return (b.time || '').localeCompare(a.time || '');
}
function confirmPending() {
  const p = state.pending;
  state.pending = null;
  const e = state.entries.find((x) => x.id === p.entryId);
  if (!e) return { text: 'Эта запись уже удалена.', tools: [] };
  state.entries = state.entries.filter((x) => x.id !== p.entryId);
  return {
    text: `Удалил ${w(e.weightG)} за ${dLong(e.measuredOn)}.`,
    tools: [{ name: 'delete_weight_entry', ok: true }],
  };
}

function sendChat(text) {
  if (!text.trim() || ui.typing) return;
  state.chat.push({ id: uid(), role: 'user', text: text.trim() });
  ui.typing = true;
  save();
  render();
  setTimeout(() => {
    const r = agentReply(text);
    state.chat.push({
      id: r.id || uid(),
      role: 'bot',
      text: r.text,
      tools: r.tools,
      confirm: r.confirm,
    });
    ui.typing = false;
    save();
    render();
    document.getElementById('chat-input')?.focus();
  }, 450);
}

/* ------------------------------------------------------------ render & events */

function render() {
  const app = document.getElementById('app');
  if (!state.signedIn) app.innerHTML = loginView();
  else if (!state.profile || state.onboarding) app.innerHTML = onboardingView();
  else {
    const views = {
      home: homeView,
      add: addView,
      history: historyView,
      chat: chatView,
      settings: settingsView,
    };
    app.innerHTML = shell(views[ui.view]());
  }
  if (ui.view === 'home') drawChart();
  if (ui.view === 'chat') {
    const m = document.getElementById('msgs');
    if (m) m.lastElementChild?.scrollIntoView({ block: 'end' });
  }
}

function go(view) {
  ui.view = view;
  ui.editId = ui.confirmDeleteId = ui.editMemId = null;
  ui.confirmAccount = false;
  ui.addError = ui.goalError = null;
  render();
  window.scrollTo(0, 0);
}

let toastTimer;
function toast(msg) {
  const el = document.getElementById('toast');
  el.textContent = msg;
  el.hidden = false;
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => (el.hidden = true), 2400);
}

document.addEventListener('click', (ev) => {
  const t = ev.target.closest('[data-nav],[data-act],[data-range],[data-step],[data-say]');
  if (!t) return;
  if (t.dataset.nav) return go(t.dataset.nav);
  if (t.dataset.range !== undefined) {
    ui.range = Number(t.dataset.range);
    return render();
  }
  if (t.dataset.step) {
    const inp = document.getElementById('add-weight');
    const v = Number(inp.value.replace(',', '.')) || 0;
    inp.value = nf1.format(Math.max(0, v + Number(t.dataset.step) * 0.1));
    return;
  }
  if (t.dataset.say) return sendChat(t.dataset.say);
  const id = t.dataset.id;
  switch (t.dataset.act) {
    case 'edit':
      ui.editId = id;
      ui.confirmDeleteId = null;
      ui.addError = null;
      return render();
    case 'cancel-edit':
      ui.editId = null;
      return render();
    case 'ask-delete':
      ui.confirmDeleteId = id;
      ui.editId = null;
      return render();
    case 'cancel-delete':
      ui.confirmDeleteId = null;
      return render();
    case 'delete':
      state.entries = state.entries.filter((e) => e.id !== id);
      ui.confirmDeleteId = null;
      save();
      render();
      return toast('Запись удалена');
    case 'chat-confirm': {
      const r = confirmPending();
      state.chat.push({ id: uid(), role: 'bot', text: r.text, tools: r.tools });
      save();
      return render();
    }
    case 'chat-cancel':
      state.pending = null;
      state.chat.push({ id: uid(), role: 'bot', text: 'Хорошо, ничего не удаляю.', tools: [] });
      save();
      return render();
    case 'chat-clear':
      state.chat = [];
      state.pending = null;
      save();
      return render();
    case 'mem-edit':
      ui.editMemId = id;
      return render();
    case 'mem-cancel':
      ui.editMemId = null;
      return render();
    case 'mem-delete':
      state.memory = state.memory.filter((m) => m.id !== id);
      save();
      render();
      return toast('Удалено из памяти');
    case 'goal-clear':
      state.goal = null;
      save();
      render();
      return toast('Цель убрана');
    case 'ask-account':
      ui.confirmAccount = true;
      return render();
    case 'cancel-account':
      ui.confirmAccount = false;
      return render();
    case 'sign-out':
      state.signedIn = false;
      save();
      return render();
    case 'register':
      state = {
        demo: false,
        signedIn: true,
        profile: null,
        goal: null,
        entries: [],
        memory: [],
        chat: [],
        pending: null,
        onboarding: true,
      };
      ui.onboardStep = 1;
      ui.addError = null;
      save();
      return render();
    case 'start-clean':
      state = {
        demo: false,
        signedIn: true,
        profile: null,
        goal: null,
        entries: [],
        memory: [],
        chat: [],
        pending: null,
        onboarding: true,
      };
      ui.onboardStep = 1;
      save();
      return render();
    case 'reset-demo':
      state = seedState();
      save();
      go('home');
      return toast('Загружены демо-данные');
  }
});

document.addEventListener('submit', (ev) => {
  ev.preventDefault();
  const f = ev.target;
  const data = Object.fromEntries(new FormData(f).entries());
  switch (f.id) {
    case 'add-form': {
      const r = parseUserWeight(data.weight);
      if (r.error) {
        ui.addError = r.error;
        return render();
      }
      if (!C.isValidLocalDate(data.date) || data.date > today()) {
        ui.addError = 'Дата не может быть в будущем.';
        return render();
      }
      state.entries.push({
        id: uid(),
        measuredOn: data.date,
        time: data.time || '',
        weightG: r.g,
        note: data.note.trim(),
        source: 'manual',
      });
      save();
      go('home');
      return toast(`Сохранено: ${w(r.g)}`);
    }
    case 'quick-form': {
      const r = parseUserWeight(data.weight);
      if (r.error) {
        ui.addError = r.error;
        return render();
      }
      state.entries.push({
        id: uid(),
        measuredOn: today(),
        time: nowTime(),
        weightG: r.g,
        note: '',
        source: 'manual',
      });
      ui.addError = null;
      save();
      render();
      return toast(`Сохранено: ${w(r.g)}`);
    }
    case 'edit-form': {
      const r = parseUserWeight(data.weight);
      if (r.error || !C.isValidLocalDate(data.date) || data.date > today()) {
        ui.addError = r.error || 'Проверьте дату.';
        return render();
      }
      const e = state.entries.find((x) => x.id === f.dataset.id);
      Object.assign(e, {
        weightG: r.g,
        measuredOn: data.date,
        time: data.time,
        note: data.note.trim(),
      });
      ui.editId = null;
      ui.addError = null;
      save();
      render();
      return toast('Изменения сохранены');
    }
    case 'chat-form':
      return sendChat(data.text || '');
    case 'profile-form':
      Object.assign(state.profile, {
        name: data.name.trim() || state.profile.name,
        unit: data.unit,
        tz: C.isValidTimeZone(data.tz) ? data.tz : state.profile.tz,
        reportFormat: data.reportFormat,
      });
      save();
      render();
      return toast('Профиль сохранён');
    case 'goal-form': {
      const tg = parseUserWeight(data.target);
      const sg = parseUserWeight(data.start);
      if (tg.error || sg.error) {
        ui.goalError = tg.error || sg.error;
        return render();
      }
      if (!C.isValidLocalDate(data.date)) {
        ui.goalError = 'Проверьте дату старта.';
        return render();
      }
      state.goal = { startWeightG: sg.g, targetWeightG: tg.g, startDate: data.date };
      ui.goalError = null;
      save();
      render();
      return toast('Цель сохранена');
    }
    case 'mem-add-form':
      if (!data.text.trim()) return;
      state.memory.push({ id: uid(), text: data.text.trim() });
      save();
      return render();
    case 'mem-edit-form': {
      const m = state.memory.find((x) => x.id === f.dataset.id);
      if (m && data.text.trim()) m.text = data.text.trim();
      ui.editMemId = null;
      save();
      return render();
    }
    case 'account-form':
      if (data.confirm.trim().toUpperCase() !== 'УДАЛИТЬ') {
        document.getElementById('acc-confirm').classList.add('err');
        return;
      }
      try {
        localStorage.removeItem(LS_KEY);
      } catch {
        /* nothing stored */
      }
      state = {
        demo: false,
        signedIn: false,
        profile: null,
        goal: null,
        entries: [],
        memory: [],
        chat: [],
        pending: null,
      };
      ui.confirmAccount = false;
      render();
      return toast('Аккаунт и все данные удалены');
    case 'login-form':
      if (!state.profile) {
        state = seedState();
      }
      state.signedIn = true;
      save();
      return go('home');
    case 'onb1-form': {
      const tz = (data.tz || '').trim();
      if (!data.name.trim()) {
        ui.addError = 'Введите имя.';
        return render();
      }
      if (!C.isValidTimeZone(tz)) {
        ui.addError = 'Неизвестный часовой пояс. Пример: Europe/Moscow.';
        return render();
      }
      state.profile = {
        name: data.name.trim(),
        email: 'you@example.com',
        unit: data.unit,
        tz,
        reportFormat: 'short',
      };
      ui.addError = null;
      ui.onboardStep = 2;
      save();
      return render();
    }
    case 'onb2-form': {
      const cur = parseUserWeight(data.weight);
      if (cur.error) {
        ui.addError = cur.error;
        return render();
      }
      let goal = null;
      if (data.target.trim()) {
        const tg = parseUserWeight(data.target);
        if (tg.error) {
          ui.addError = tg.error;
          return render();
        }
        goal = { startWeightG: cur.g, targetWeightG: tg.g, startDate: today() };
      }
      state.entries = [
        {
          id: uid(),
          measuredOn: today(),
          time: nowTime(),
          weightG: cur.g,
          note: '',
          source: 'manual',
        },
      ];
      state.goal = goal;
      state.onboarding = false;
      state.chat = [
        {
          id: uid(),
          role: 'bot',
          text: `Привет, ${state.profile.name}! Записывайте вес прямо сюда, например «сегодня ${wNum(cur.g)}». Я посчитаю изменения, средние и прогноз.`,
          tools: [],
        },
      ];
      ui.addError = null;
      save();
      go('home');
      return toast('Профиль создан');
    }
  }
});

document.addEventListener('pointermove', (ev) => {
  if (ev.target.closest && ev.target.closest('#chart')) onChartMove(ev);
});
document.addEventListener('pointerleave', onChartLeave, true);
document.addEventListener('pointerdown', (ev) => {
  if (ev.target.closest && ev.target.closest('#chart')) onChartMove(ev);
  else onChartLeave();
});
let resizeTimer;
window.addEventListener('resize', () => {
  clearTimeout(resizeTimer);
  resizeTimer = setTimeout(drawChart, 120);
});

state = load() || seedState();
const initial = (location.hash || '').slice(1);
if (NAV.some(([k]) => k === initial)) ui.view = initial;
render();
