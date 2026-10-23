# CHANGELOG

## 2026-10-23
- Каркас монорепо, расчётное ядро `@weight-ai/core` с 46 тестами.
- Начальная миграция Supabase: 9 таблиц, RLS, column-level grants, удаление аккаунта.
- Локальный шим Supabase и скрипт установки БД.
- Проект перенесён в GitHub-репозиторий `iviwebstudio/iweight` (история сохранена).
- Интерактивное демо `apps/demo` (`pnpm --filter @weight-ai/demo build` → `apps/demo/dist/index.html`).
- `packages/contracts`: Zod-контракты API и типизированный клиент.
- `apps/api`: Fastify API (профиль, записи, цели, аналитика, память, диалоги, удаление аккаунта),
  RLS на каждый запрос, лимиты, безопасные логи; GPT-агент на Responses API с 10 инструментами,
  подтверждением удалений, памятью, резюме диалогов, учётом токенов и суточным бюджетом.
  46 интеграционных тестов на реальном Postgres. Документы: `docs/API_SPEC.md`, `docs/AI_AGENT.md`.
