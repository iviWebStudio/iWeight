/** Minimal typed client for web and mobile. Tokens come from the caller (Supabase session). */
import type {
  AnalyticsHistory,
  AnalyticsSummary,
  ChatRequest,
  ChatResponse,
  Conversation,
  ConversationDetail,
  CreateGoal,
  CreateWeight,
  ErrorResponse,
  Goal,
  HistoryQuery,
  ListWeightsQuery,
  Me,
  MemoryItem,
  PatchMe,
  PatchWeight,
  WeightEntry,
  WeightList,
} from './index.js';

export class ApiError extends Error {
  constructor(
    readonly status: number,
    readonly code: ErrorResponse['error']['code'] | 'NETWORK',
    message: string,
    readonly details?: unknown,
  ) {
    super(message);
    this.name = 'ApiError';
  }
}

export interface ApiClientOptions {
  baseUrl: string;
  getToken: () => Promise<string | null> | string | null;
  fetch?: typeof fetch;
}

export function createApiClient(opts: ApiClientOptions) {
  const doFetch = opts.fetch ?? fetch;
  async function call<T>(
    method: string,
    path: string,
    body?: unknown,
    query?: Record<string, unknown>,
  ): Promise<T> {
    const url = new URL(path, opts.baseUrl);
    for (const [k, v] of Object.entries(query ?? {}))
      if (v !== undefined) url.searchParams.set(k, String(v));
    const token = await opts.getToken();
    let res: Response;
    try {
      res = await doFetch(url, {
        method,
        headers: {
          ...(body !== undefined ? { 'content-type': 'application/json' } : {}),
          ...(token ? { authorization: `Bearer ${token}` } : {}),
        },
        body: body !== undefined ? JSON.stringify(body) : undefined,
      });
    } catch (e) {
      throw new ApiError(0, 'NETWORK', e instanceof Error ? e.message : 'Network error');
    }
    if (res.status === 204) return undefined as T;
    const json = (await res.json().catch(() => null)) as unknown;
    if (!res.ok) {
      const err = (json as ErrorResponse | null)?.error;
      throw new ApiError(
        res.status,
        err?.code ?? 'INTERNAL',
        err?.message ?? res.statusText,
        err?.details,
      );
    }
    return json as T;
  }

  return {
    me: () => call<Me>('GET', '/v1/me'),
    updateMe: (patch: PatchMe) => call<Me>('PATCH', '/v1/me', patch),
    deleteMe: () => call<void>('DELETE', '/v1/me', { confirm: 'DELETE' }),
    listWeights: (q: ListWeightsQuery = {}) => call<WeightList>('GET', '/v1/weights', undefined, q),
    createWeight: (input: CreateWeight) => call<WeightEntry>('POST', '/v1/weights', input),
    updateWeight: (id: string, patch: PatchWeight) =>
      call<WeightEntry>('PATCH', `/v1/weights/${id}`, patch),
    deleteWeight: (id: string) => call<void>('DELETE', `/v1/weights/${id}`),
    summary: () => call<AnalyticsSummary>('GET', '/v1/analytics/summary'),
    history: (q: HistoryQuery = {}) =>
      call<AnalyticsHistory>('GET', '/v1/analytics/history', undefined, q),
    activeGoal: () => call<{ goal: Goal | null }>('GET', '/v1/goals/active'),
    setGoal: (input: CreateGoal) => call<Goal>('POST', '/v1/goals', input),
    clearGoal: () => call<void>('DELETE', '/v1/goals/active'),
    chat: (input: ChatRequest) => call<ChatResponse>('POST', '/v1/chat', input),
    conversations: () => call<{ items: Conversation[] }>('GET', '/v1/conversations'),
    conversation: (id: string) => call<ConversationDetail>('GET', `/v1/conversations/${id}`),
    deleteConversation: (id: string) => call<void>('DELETE', `/v1/conversations/${id}`),
    memory: () => call<{ items: MemoryItem[] }>('GET', '/v1/memory'),
    addMemory: (content: string, kind: MemoryItem['kind'] = 'fact') =>
      call<MemoryItem>('POST', '/v1/memory', { kind, content }),
    updateMemory: (id: string, patch: Partial<Pick<MemoryItem, 'kind' | 'content'>>) =>
      call<MemoryItem>('PATCH', `/v1/memory/${id}`, patch),
    deleteMemory: (id: string) => call<void>('DELETE', `/v1/memory/${id}`),
  };
}
export type ApiClient = ReturnType<typeof createApiClient>;
