# DEPLOYMENT

Схема: **Supabase** (Postgres + Auth, бесплатный тариф) + **Vercel Hobby** — два проекта из одного
GitHub-репозитория `iviwebstudio/iweight`: `iweight-api` (`apps/api`, serverless-функция) и `iweight-web`
(`apps/web`, Next.js). Команды сборки лежат в `apps/*/vercel.json` — в интерфейсе Vercel их не трогать.

## Supabase (проект `weight-ai`, ref `rhuveovxnvfbkhefzzng`, eu-west-1)
- URL: `https://rhuveovxnvfbkhefzzng.supabase.co`
- Публичный ключ (можно показывать): `sb_publishable_8HwyQkd4gbVlEeIx_ZSpCQ_2K9hbc4U`
- Миграции: `supabase/migrations/*.sql` по порядку (применяются через Supabase MCP или SQL Editor).
- Роль API `weight_api` создаётся миграцией **без пароля**. Пароль задаёт владелец в SQL Editor:
  `alter role weight_api with password '…';` — пароль не попадает ни в git, ни в чат.
- Токены: если проект на старом общем секрете (HS256), API нужен `SUPABASE_JWT_SECRET`
  (Project Settings → JWT Keys → Legacy JWT secret). Лучше перевести проект на асимметричные ключи
  (JWT Keys → создать ключ ECC P-256 → сделать текущим) — тогда секрет не нужен, API берёт JWKS.
- Authentication → URL Configuration → Site URL = адрес сайта.

## Vercel: `iweight-api`
Root Directory `apps/api`, Preset **Other**. Переменные (Production и Preview):

| Переменная | Значение |
|---|---|
| `AUTH_PROVIDER` | `supabase` |
| `SUPABASE_URL` | `https://rhuveovxnvfbkhefzzng.supabase.co` |
| `SUPABASE_JWT_SECRET` | только для HS256-проекта (см. выше) |
| `DATABASE_URL` | Supabase → Connect → **Transaction pooler** (порт 6543), пользователь `weight_api.rhuveovxnvfbkhefzzng`, ваш пароль |
| `DATABASE_SSL` | `require` (или `verify` + `DATABASE_CA_CERT` — PEM из Database Settings → SSL) |
| `CORS_ORIGINS` | адрес сайта, например `https://iweight-web.vercel.app` |
| `OPENAI_API_KEY`, `OPENAI_MODEL` | ключ и модель; без них чат отвечает «не подключён» |
| `CHAT_DAILY_TOKEN_BUDGET` | `200000` |
| `OPENAI_PRICE_INPUT_PER_MTOK`, `OPENAI_PRICE_OUTPUT_PER_MTOK` | цены модели, для учёта расходов |

Проверка: `https://<api>/ready` → `{"status":"ready","database":true,...}`.

## Vercel: `iweight-web`
Root Directory `apps/web`, Preset **Next.js**. Переменные:

| Переменная | Значение |
|---|---|
| `NEXT_PUBLIC_API_URL` | адрес API, например `https://iweight-api.vercel.app` |
| `NEXT_PUBLIC_SUPABASE_URL` | `https://rhuveovxnvfbkhefzzng.supabase.co` |
| `NEXT_PUBLIC_SUPABASE_ANON_KEY` | `sb_publishable_8HwyQkd4gbVlEeIx_ZSpCQ_2K9hbc4U` |

`NEXT_PUBLIC_*` встраиваются при сборке: после их изменения нужен Redeploy.

## Ограничения бесплатных тарифов
- Supabase Free: 500 МБ БД; проект засыпает после 7 дней без активности (будится в панели).
  Встроенная почта Supabase — несколько писем в час; для реальных пользователей нужен свой SMTP.
- Vercel Hobby: только некоммерческое использование; функция до 60 с (хватает для чата).
- Rate-limit API хранится в памяти экземпляра функции — в serverless это защита «на экземпляр».
  Для публичного запуска — общий счётчик (например, Upstash Redis) — НЕ СДЕЛАНО.

## Откат
Vercel → Deployments → предыдущий деплой → **Promote to Production**. Миграции БД только вперёд;
разрушительные миграции на prod — только с разрешения владельца и после резервной копии.
