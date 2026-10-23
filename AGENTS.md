# AGENTS.md — инструкции для любого AI-агента в этом репозитории

## Перед началом работы
1. Прочитай `docs/MASTER_PROMPT.md` (полное ТЗ владельца — главный источник требований).
2. Прочитай `docs/PROJECT_STATE.md`, `docs/IMPLEMENTATION_PLAN.md`, `docs/DECISIONS.md`,
   `docs/BLOCKERS.md`.
3. Сверь документы с реальным кодом (`git log`, структура, `pnpm -r test`). Если расходятся —
   выясни фактическое состояние и исправь документацию.

## Жёсткие правила
- Внутри продукта работает **GPT через официальный OpenAI API** (Responses API). Не заменять
  другим поставщиком. Модель — только из `OPENAI_MODEL`.
- Вес/цели — только из БД. LLM не считает арифметику — для этого `packages/core`.
- `user_id` от клиента не принимать; только `sub` проверенного JWT. RLS обязательна (ADR-005).
- Секреты только в `.env` (в `.gitignore`) / секретах хостинга. `.env.example` без значений.
- Не помечать тест пройденным, если он не запускался → «НЕ ПРОВЕРЕН».
- Перед необратимыми действиями (prod-миграции, удаление данных, платные ресурсы) — спросить владельца.

## После каждого этапа
Обнови `PROJECT_STATE.md` (Сделано / Проверено / Не проверено / Блокеры / Следующий шаг),
`IMPLEMENTATION_PLAN.md`, `DECISIONS.md`, `CHANGELOG.md`; проверь `git diff`; закоммить.

## Команды
```bash
pnpm install
sudo -u postgres bash scripts/db-local-setup.sh   # локальные БД weight_ai_dev / weight_ai_test
pnpm --filter @weight-ai/core test
pnpm -r typecheck
```
Если есть Docker и Supabase CLI — можно вместо шима: `supabase start` + `supabase db reset`.
