# API_SPEC

Источник истины по форматам — Zod-схемы в `packages/contracts/src/index.ts`; там же типизированный
клиент `createApiClient` для web и Android. Этот файл — обзор.

## Общие правила
- База: `/v1`. JSON в camelCase. Вес — целые граммы (`weightG`), даты — `YYYY-MM-DD` в часовом поясе
  профиля, моменты — ISO 8601 с зоной.
- Аутентификация: `Authorization: Bearer <access token>` (Supabase; в dev/CI — локальный адаптер,
  ADR-007). `user_id` из запроса не принимается; лишние поля в теле → 400.
- Ошибки: `{ "error": { "code", "message", "details?" } }`. Коды: `VALIDATION_ERROR` 400,
  `UNAUTHORIZED` 401, `FORBIDDEN` 403, `NOT_FOUND` 404 (в том числе чужие id — RLS их не показывает),
  `CONFLICT`/`DUPLICATE_ENTRY` 409, `PAYLOAD_TOO_LARGE` 413, `RATE_LIMITED` 429,
  `AI_BUDGET_EXCEEDED` 429, `AI_NOT_CONFIGURED` 503, `AI_UNAVAILABLE` 502/503, `INTERNAL` 500.
- Лимиты: тело ≤ 16 КБ; `RATE_LIMIT_PER_MINUTE` на пользователя (до входа — на IP);
  `/v1/chat` — `CHAT_RATE_LIMIT_PER_MINUTE`; вход/регистрация — `AUTH_RATE_LIMIT_PER_MINUTE`.

## Endpoint-ы
| Метод и путь | Назначение |
|---|---|
| `GET /health`, `GET /ready` | живость; готовность (БД, настроен ли AI) — без токена |
| `POST /v1/auth/local/signup`, `/login` | только `AUTH_PROVIDER=local` (dev/CI) |
| `GET /v1/me` | профиль + настройки агента |
| `PATCH /v1/me` | имя, пояс (IANA), единицы, рост, `onboarded`, `preferences{language, reportFormat, agentTone, memoryEnabled}` |
| `DELETE /v1/me` | тело `{ "confirm": "DELETE" }` → удаление аккаунта и всех данных (каскадом) |
| `GET /v1/weights?from&to&limit&cursor` | записи, новые сверху, курсорная пагинация |
| `GET /v1/weights/:id` | одна запись |
| `POST /v1/weights` | `weightG`, `measuredOn?` (по умолчанию сегодня в поясе), `measuredAt?`, `note?`, `source?`, `clientEntryId?`, `allowDuplicate?`; 201 — создано, 200 — повтор с тем же `clientEntryId` |
| `PATCH /v1/weights/:id` | исправление; перенос на другой день сбрасывает время |
| `DELETE /v1/weights/:id` | 204 |
| `GET /v1/analytics/summary` | `computeSummary` ядра: последнее/предыдущее, изменения, средние 7/30 с числом измерений, темп, цель, прогноз с 80 % интервалом |
| `GET /v1/analytics/history?from&to` | дневной ряд (утреннее значение) + скользящее среднее 7 дней, цель, прогноз; по умолчанию 90 дней |
| `GET /v1/goals/active` | `{ goal }` |
| `POST /v1/goals` | `targetWeightG`, `startWeightG?` (по умолчанию последнее утреннее), `startDate?`; прежняя цель → `replaced` |
| `DELETE /v1/goals/active` | цель → `cancelled` |
| `GET/POST /v1/memory`, `PATCH/DELETE /v1/memory/:id` | память агента, видимая и редактируемая пользователем (≤ 100 записей) |
| `POST /v1/chat` | `message`, `conversationId?`, `clientMessageId?` → ответ агента, вызванные инструменты, ожидающее подтверждения действие |
| `GET /v1/conversations`, `GET/DELETE /v1/conversations/:id` | диалоги |

## Правила записи веса (ADR-004)
- Дата не в будущем (по поясу пользователя) и не старше 10 лет; вес 20–400 кг.
- `measuredAt` задаёт дату сам; если передана и `measuredOn`, они должны совпадать.
- Та же дата и тот же вес без времени → 409 `DUPLICATE_ENTRY` (`details.existingId`), пока клиент
  не передал `allowDuplicate: true`. Совпадение точного момента → 409.
- Повтор с тем же `clientEntryId` (ретрай, офлайн-синхронизация) возвращает ту же запись.

## Чат
- Повтор `POST /v1/chat` с тем же `clientMessageId` не запускает агента второй раз, если ответ уже
  сохранён; если прошлая попытка упала до ответа — агент запускается снова без дубля сообщения.
- `pendingAction` в ответе — удаление, ждущее подтверждения (ADR-009); клиент может показать кнопки
  «Да/Нет», а ответ пользователя отправить обычным сообщением.
- `limited: true` — агент упёрся в лимит шагов и дал итоговый ответ без инструментов.
