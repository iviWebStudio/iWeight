# IMPLEMENTATION_PLAN

Легенда: [x] сделано и проверено · [~] начато · [ ] не начато

1. [x] Обследование среды, каркас монорепо
2. [x] Модель данных, миграция, RLS-политики (тесты RLS — в шаге 4)
3. [x] Расчётное ядро `packages/core` (46 тестов)
3a. [x] Интерактивное демо `apps/demo` (ADR-011): все основные экраны на реальном ядре, без сервера
4. [x] Контракты и API (`packages/contracts`, `apps/api`; 46 интеграционных тестов на реальной БД)
   - [x] Zod-схемы, формат ошибок, типизированный клиент `createApiClient`
   - [x] `config.ts` (env через Zod, local-auth запрещён в production), `db.ts` (`withUser` → RLS)
   - [x] auth: Supabase JWKS и локальный HS256-адаптер (ADR-007)
   - [x] endpoint-ы ТЗ §9 + health/ready, goals, memory, conversations, `DELETE /v1/me`
   - [x] правила записи веса (пояс, будущие даты, ADR-004, идемпотентность)
   - [x] rate-limit по пользователю, лимит тела 16 КБ, helmet, CORS, логи без персональных данных
   - [x] тесты: вертикальный срез, изоляция A/B (API и сырой SQL), fail-closed роль API
   - [ ] проверка на реальном Supabase (JWKS, пулер, `delete_current_user`) — нужен проект (BLOCKERS №2)
5. [x] GPT-агент (Responses API) — код и тесты на скриптовом двойнике модели
   - [x] 10 инструментов, Zod-аргументы, исполнение через `withUser`, готовые строки чисел (ADR-013)
   - [x] лимит шагов, таймауты/ретраи SDK, маппинг ошибок, `agent_runs` с токенами и стоимостью,
     суточный бюджет (ADR-014)
   - [x] контекст только текущего пользователя, память, резюме длинных диалогов, ADR-009
   - [ ] прогон на настоящей модели и набор тестовых диалогов с живым GPT — нужен ключ (BLOCKERS №1)
6. [ ] Web (Next.js 16, React 19, Recharts) — 15 экранов из ТЗ §11, Playwright e2e
7. [ ] Android (Expo 58, RN 0.88) — SecureStore для сессии, офлайн-очередь с `client_entry_id`,
   явная пометка «ожидает отправки», `eas.json`
8. [ ] CI (GitHub Actions: format, typecheck, test с service-контейнером postgres, build),
   DEPLOYMENT/RUNBOOK/SECURITY, черновики Terms/Privacy, чек-лист запуска

Проверенные версии пакетов (npm, 2026-10-23): next 16.4.3, react 19.3.1, expo 58.0.17,
react-native 0.88.0, fastify 5.12.7, zod 4.6.7, openai 7.43.0, vitest 5.0.5,
@playwright/test 1.64.1, recharts 3.10.1, @supabase/supabase-js 2.118.0, pg 8.23.1, jose 6.2.13.
