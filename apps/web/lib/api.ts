'use client';
import { ApiError, createApiClient } from '@weight-ai/contracts';
import { API_URL, auth } from './auth';

export const api = createApiClient({ baseUrl: API_URL, getToken: () => auth.getToken() });
export { ApiError };

/** User-facing Russian text for an API failure. */
export function errorText(e: unknown): string {
  if (!(e instanceof ApiError)) return 'Что-то пошло не так. Попробуйте ещё раз.';
  switch (e.code) {
    case 'NETWORK':
      return 'Нет связи с сервером. Данные не сохранены — повторите, когда появится сеть.';
    case 'UNAUTHORIZED':
      return 'Сессия истекла. Войдите снова.';
    case 'NOT_FOUND':
      return 'Запись не найдена — возможно, она уже удалена.';
    case 'DUPLICATE_ENTRY':
      return 'Такой вес за эту дату уже записан.';
    case 'RATE_LIMITED':
      return 'Слишком много запросов. Подождите минуту.';
    case 'AI_NOT_CONFIGURED':
      return 'AI-помощник ещё не подключён на сервере. Дневник, графики и статистика работают.';
    case 'AI_UNAVAILABLE':
      return 'AI-помощник сейчас недоступен. Повторите через минуту.';
    case 'AI_BUDGET_EXCEEDED':
      return 'Дневной лимит AI-помощника исчерпан. Он снова заработает после полуночи.';
    case 'VALIDATION_ERROR':
      return `Проверьте данные: ${e.message}.`;
    default:
      return 'Ошибка сервера. Попробуйте ещё раз.';
  }
}
