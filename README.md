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
pnpm --filter @weight-ai/api test        # интеграционные тесты на weight_ai_test
cp .env.example apps/api/.env             # задать LOCAL_JWT_SECRET (≥32 символа)
pnpm dev:api                              # http://localhost:4000/ready
```
Без `OPENAI_API_KEY`/`OPENAI_MODEL` всё API работает, а `/v1/chat` отвечает 503 `AI_NOT_CONFIGURED`.

## Структура
- `packages/core` — расчёты (готово, покрыто тестами)
- `packages/contracts` — Zod-контракты API и типизированный клиент (готово)
- `apps/api` — Fastify API + GPT-агент (готово, см. `docs/API_SPEC.md`, `docs/AI_AGENT.md`)
- `apps/demo` — автономное интерактивное демо интерфейса (один HTML)
- `apps/web`, `apps/mobile` — клиенты (не начато)
- `supabase/migrations` — схема БД; `db/local` — шим Supabase для локального Postgres
