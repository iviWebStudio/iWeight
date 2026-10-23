# IMPLEMENTATION_PLAN

Легенда: [x] сделано и проверено · [~] начато · [ ] не начато

1. [x] Обследование среды, каркас монорепо
2. [x] Модель данных, миграция, RLS-политики (тесты RLS — в шаге 4)
3. [x] Расчётное ядро `packages/core` (46 тестов)
4. [~] Контракты и API
   - [ ] `packages/contracts`: Zod-схемы запросов/ответов (camelCase), формат ошибок
     `{ error: { code, message, details? } }`, типизированный fetch-клиент для web/mobile
   - [ ] `apps/api/src/config.ts` (env через Zod), `db.ts` (`withUser(userId, fn)`: BEGIN →
     `SET LOCAL ROLE authenticated` → `set_config('request.jwt.claims', json, true)`)
   - [ ] auth-адаптер (ADR-007), `buildApp(deps)` для тестов, `server.ts`
   - [ ] Endpoint-ы из ТЗ §9 + `GET /health`, `GET /ready`, `GET/DELETE /v1/goals[/active]`,
     `GET/DELETE /v1/conversations[/:id]`, `GET/POST/PATCH/DELETE /v1/memory`, `DELETE /v1/me`
     (тело `{ "confirm": "DELETE" }` → `delete_current_user()`)
   - [ ] Правила `POST /v1/weights`: `measuredOn` по умолчанию = сегодня в поясе профиля; запрет
     будущих дат (по поясу пользователя) и дат старше 10 лет; ADR-004 для дубликатов
   - [ ] `@fastify/rate-limit` по `sub`, `bodyLimit` 16 КБ, helmet, CORS по `CORS_ORIGINS`, логи без
     веса/email (redact)
   - [ ] Интеграционные тесты (vitest + реальная БД `weight_ai_test`): вертикальный срез и
     изоляция A/B (чтение/изменение/удаление чужой записи, подмена `user_id`)
5. [ ] GPT-агент (Responses API, SDK `openai@7.43.0` уже установлен в apps/api)
   - инструменты из ТЗ §10, аргументы проверяются Zod, исполнение только через `withUser`
   - лимит итераций, таймауты, ретраи 429/5xx с backoff, `agent_runs` с токенами и стоимостью
   - память: `agent_memory` (уровень 3), резюме `conversations.summary` (уровень 6) — не может
     менять вес/цели; контекст только текущего пользователя
   - ADR-009 для удаления; тестовые диалоги на мок-клиенте OpenAI с проверкой вызванных
     инструментов и фактических изменений в БД
6. [ ] Web (Next.js 16, React 19, Recharts) — 15 экранов из ТЗ §11, Playwright e2e
7. [ ] Android (Expo 58, RN 0.88) — SecureStore для сессии, офлайн-очередь с `client_entry_id`,
   явная пометка «ожидает отправки», `eas.json`
8. [ ] CI (GitHub Actions: format, typecheck, test с service-контейнером postgres, build),
   DEPLOYMENT/RUNBOOK/SECURITY, черновики Terms/Privacy, чек-лист запуска

Проверенные версии пакетов (npm, 2026-10-23): next 16.4.3, react 19.3.1, expo 58.0.17,
react-native 0.88.0, fastify 5.12.7, zod 4.6.7, openai 7.43.0, vitest 5.0.5,
@playwright/test 1.64.1, recharts 3.10.1, @supabase/supabase-js 2.118.0, pg 8.23.1, jose 6.2.13.
