# Weight AI

Многопользовательское приложение для мониторинга веса: web (Next.js), Android (Expo),
API (Fastify), PostgreSQL/Supabase (Auth + RLS), GPT-агент через OpenAI API.

Статус: ранняя разработка — см. `docs/PROJECT_STATE.md`. Требования: `docs/MASTER_PROMPT.md`.

## Быстрый старт (локально)
Требуется Node ≥ 22, pnpm 10, PostgreSQL 16.
```bash
pnpm install
sudo -u postgres bash scripts/db-local-setup.sh
pnpm --filter @weight-ai/core test
```

## Структура
- `packages/core` — расчёты (готово, покрыто тестами)
- `packages/contracts` — Zod-контракты API (не начато)
- `apps/api` — Fastify API + GPT-агент (не начато)
- `apps/web`, `apps/mobile` — клиенты (не начато)
- `supabase/migrations` — схема БД; `db/local` — шим Supabase для локального Postgres
