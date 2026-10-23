# DECISIONS (ADR-журнал)

## ADR-001 TypeScript 5.9.3, а не 7.x (2026-10-23)
`latest` в npm — TS 7 (нативный порт). Совместимость Next 16 / Expo 58 / Vitest 5 с ним не
проверена → зафиксирован 5.9.3. Пересмотреть отдельной задачей.

## ADR-002 Вес — целые граммы (2026-10-23)
Без плавающей точки в БД и расчётах. kg/lb — только на границах (`core/units.ts`).

## ADR-003 Календарная дата в поясе пользователя (2026-10-23)
`measured_on date` = дата в часовом поясе профиля; `measured_at timestamptz` — опционально.
Вся арифметика дней — по epoch-дням UTC (DST не сдвигает дни).

## ADR-004 Несколько записей в день разрешены (2026-10-23)
Аналитика берёт одно значение на день — самое раннее по `measured_at` (записи без времени идут
после записей со временем). Дубликаты: идемпотентный повтор по `(user_id, client_entry_id)`;
уникальность `(user_id, measured_at)`; совпадение даты+веса без времени → API отвечает 409
`DUPLICATE_ENTRY`, если клиент не передал `allowDuplicate`.

## ADR-005 RLS применяется и в API (2026-10-23)
API подключается к Postgres отдельной ролью без собственных прав на таблицы и в каждой транзакции
делает `SET LOCAL ROLE authenticated` + `set_config('request.jwt.claims', …, true)`. Ошибка в коде
API не может обойти RLS. Локально роль `weight_api` получает `authenticated` с `INHERIT FALSE`
(fail-closed). На Supabase — пользователь пулера (transaction mode поддерживает `SET LOCAL`).
`user_id` клиента никогда не принимается — только `sub` проверенного JWT.

## ADR-006 Локальный Postgres без Docker + шим Supabase (2026-10-23)
В песочнице Docker-демон недоступен → `supabase start` невозможен. `db/local/00_supabase_shim.sql`
воспроизводит роли, `auth.users`, `auth.uid()`. Миграции в `supabase/migrations` — те же, что
пойдут в Supabase. На машине с Docker можно использовать `supabase start` вместо шима.

## ADR-007 Адаптер аутентификации (план, 2026-10-23)
`AUTH_PROVIDER=supabase` (по умолчанию): API проверяет JWT Supabase через JWKS
(`${SUPABASE_URL}/auth/v1/.well-known/jwks.json`, aud `authenticated`), клиенты логинятся
`@supabase/supabase-js`. `AUTH_PROVIDER=local`: только dev/CI — `/v1/auth/local/{signup,login}`,
scrypt-хэши в шим-таблице, HS256-токены той же формы; сервер отказывается стартовать с ним при
`NODE_ENV=production`.

## ADR-008 История целей (2026-10-23)
Смена цели = старая получает `replaced`, новая вставляется в той же транзакции. Одна активная
цель (частичный уникальный индекс).

## ADR-009 Подтверждение разрушительных действий через чат (2026-10-23)
`delete_weight_entry` без `confirmation_id` не удаляет, а создаёт `conversations.pending_action`
(тип, id записи, срок 10 мин) и возвращает `confirmation_required`. Исполнение — только с этим id
и только если после создания пришло новое сообщение пользователя. Удаление аккаунта через чат
недоступно вовсе (только UI с вводом подтверждения).

## ADR-010 Конфигурация агента (план, 2026-10-23)
Тексты системной инструкции версионируются в git (`apps/api/src/agent/prompts/vN.ts`);
`agent_config_versions` хранит активную версию, разрешённые инструменты, лимит итераций и снимок
промпта для аудита. Модель — `OPENAI_MODEL` (опционально `model_override` в строке конфига).
