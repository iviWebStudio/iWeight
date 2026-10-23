# PROJECT_STATE

_Обновлено: 2026-10-23. Сессия 1 (Claude в claude.ai, облачная песочница) прервана по просьбе владельца
для переноса работы в Claude Code. Сессия 2 (Claude Code): код и история импортированы в
GitHub-репозиторий `iviwebstudio/iweight`._

## Этап: 1–3 (обследование, модель данных, расчётное ядро) + начало этапа 4 (API)

### Сделано
- Монорепо: pnpm workspaces + Turborepo, TypeScript 5.9.3, Prettier. Корень: `package.json`,
  `pnpm-workspace.yaml`, `turbo.json`, `tsconfig.base.json`, `.gitignore` (`.env` исключён).
- `packages/core` — детерминированное расчётное ядро, **готово**:
  - `dates.ts` — календарные даты `YYYY-MM-DD`, арифметика по epoch-дням (DST-безопасно),
    дата инстанта в IANA-поясе.
  - `units.ts` — вес хранится в целых граммах; конверсия kg/lb; диапазон 20–400 кг.
  - `analytics.ts` — дневной ряд (утреннее = самое раннее измерение дня), средние за 7/30
    календарных дней с количеством измерений (пропуски не заполняются), OLS-тренд, прогресс цели
    отдельно для снижения/набора/поддержания, анализ темпа (14 vs предыдущие 14 дней), прогноз с
    80 % интервалом (t-распределение) и статусами `insufficient_data / no_trend / moving_away /
    too_far / achieved / ok`, сводка `computeSummary`. Пороги — в `ANALYTICS_RULES`.
- `supabase/migrations/20261023000001_init.sql` — схема (9 таблиц из ТЗ), ограничения, индексы,
  column-level GRANT, RLS `user_id = auth.uid()` на всех пользовательских таблицах, триггер
  создания профиля, `delete_current_user()`, `conversations.pending_action` для подтверждения
  удалений через чат.
- `db/local/00_supabase_shim.sql` + `10_local_grants.sql` + `scripts/db-local-setup.sh` —
  локальный Postgres 16 без Docker, эмулирующий `auth.uid()`/роли Supabase.
- `packages/contracts`, `apps/api` — только `package.json`/`tsconfig` (зависимости установлены),
  **исходного кода ещё нет**.

### Проверено
- `packages/core`: `tsc --noEmit` — OK; `vitest run` — **46/46 пройдено** (високосный год, смена
  месяца/года, DST, часовые пояса, пропуски, несколько записей в день, дубликаты, нулевой период,
  недостаточно данных, достижение/превышение цели, отсутствие тренда, некорректные дата/вес,
  независимые ручные OLS-примеры).
- Миграция применяется на чистый PostgreSQL 16.15 (через шим) без ошибок.
- Сессия 2 (после импорта в GitHub): `pnpm install --frozen-lockfile` — OK; `core` — 46/46;
  `pnpm -r typecheck` падает на `packages/contracts` (TS18003: нет файлов в `src`) — ожидаемо,
  пакет ещё пуст; исправится с появлением контрактов.

### Не проверено
- RLS-тесты изоляции A/B — **НЕ ПРОВЕРЕНЫ** (тесты не написаны).
- Применение миграции на реальный Supabase — **НЕ ПРОВЕРЕНО** (особенно `delete_current_user`:
  права роли `postgres` на `auth.users`).
- Всё остальное (API, агент, web, Android, CI, деплой) — не начато.

### Блокеры
См. `docs/BLOCKERS.md`.

### Следующий шаг
`docs/IMPLEMENTATION_PLAN.md`, шаг 4 → контракты Zod и Fastify API, затем вертикальный срез.
