import type { ErrorCode } from '@weight-ai/contracts';
import { ZodError } from 'zod';

export class ApiError extends Error {
  constructor(
    readonly status: number,
    readonly code: ErrorCode,
    message: string,
    readonly details?: unknown,
  ) {
    super(message);
  }
}

export const notFound = (what = 'Resource') => new ApiError(404, 'NOT_FOUND', `${what} not found`);
export const badRequest = (message: string, details?: unknown) =>
  new ApiError(400, 'VALIDATION_ERROR', message, details);

interface PgError {
  code?: string;
  constraint?: string;
}

/** Maps any thrown value to an HTTP error without leaking internals. */
export function toApiError(err: unknown): ApiError {
  if (err instanceof ApiError) return err;
  if (err instanceof ZodError) {
    return badRequest(
      'Invalid request',
      err.issues.map((i) => ({ path: i.path.join('.'), message: i.message })),
    );
  }
  const e = err as PgError & { statusCode?: number; code?: string };
  if (e && typeof e === 'object') {
    if (e.code === 'FST_ERR_CTP_BODY_TOO_LARGE' || e.statusCode === 413)
      return new ApiError(413, 'PAYLOAD_TOO_LARGE', 'Request body too large');
    if (e.code === 'FST_ERR_CTP_INVALID_JSON_BODY' || e.code === 'FST_ERR_CTP_EMPTY_JSON_BODY')
      return badRequest('Malformed JSON body');
    if (e.code === 'FST_ERR_CTP_INVALID_MEDIA_TYPE')
      return new ApiError(415 as number, 'VALIDATION_ERROR', 'Unsupported content type');
    if (e.statusCode === 429) return new ApiError(429, 'RATE_LIMITED', 'Too many requests');
    // Postgres
    if (e.code === '23505') {
      if (e.constraint === 'weight_entries_instant_uq')
        return new ApiError(409, 'DUPLICATE_ENTRY', 'An entry with this exact time already exists');
      return new ApiError(409, 'CONFLICT', 'Conflicting concurrent change, retry the request');
    }
    if (e.code === '23514' || e.code === '22P02' || e.code === '22007' || e.code === '22008')
      return badRequest('Value rejected by the database');
    if (e.code === '42501') return new ApiError(403, 'FORBIDDEN', 'Not allowed');
    if (e.code === '40001' || e.code === '40P01')
      return new ApiError(409, 'CONFLICT', 'Conflicting concurrent change, retry the request');
  }
  return new ApiError(500, 'INTERNAL', 'Internal error');
}
