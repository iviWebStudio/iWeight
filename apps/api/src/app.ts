import cors from '@fastify/cors';
import helmet from '@fastify/helmet';
import rateLimit from '@fastify/rate-limit';
import Fastify, { type FastifyInstance, type FastifyRequest } from 'fastify';
import type pg from 'pg';
import type { ModelClient } from './agent/model.js';
import { bearer, type AuthVerifier, type LocalAuth } from './auth.js';
import type { Config } from './config.js';
import { ping } from './db.js';
import { ApiError, toApiError } from './errors.js';
import { registerRoutes } from './routes/index.js';

declare module 'fastify' {
  interface FastifyRequest {
    userId: string | null;
  }
}

export interface AppDeps {
  config: Config;
  pool: pg.Pool;
  verifier: AuthVerifier;
  localAuth: LocalAuth | null;
  model: ModelClient | null;
  now?: () => Date;
}

export async function buildApp(deps: AppDeps): Promise<FastifyInstance> {
  const { config } = deps;
  const app = Fastify({
    trustProxy: config.TRUST_PROXY,
    bodyLimit: 16 * 1024,
    logger:
      config.LOG_LEVEL === 'silent'
        ? false
        : {
            level: config.LOG_LEVEL,
            // No tokens, weights, notes, messages or emails in logs.
            redact: ['req.headers.authorization', 'req.headers.cookie', 'req.body', 'res.body'],
            serializers: {
              req: (r: FastifyRequest) => ({
                method: r.method,
                url: r.url.split('?')[0],
                reqId: r.id,
              }),
            },
          },
    genReqId: () => crypto.randomUUID(),
  });

  app.decorateRequest('userId', null);

  await app.register(helmet, { contentSecurityPolicy: false });
  await app.register(cors, {
    origin: (origin, cb) => cb(null, !origin || config.corsOrigins.includes(origin)),
    methods: ['GET', 'POST', 'PATCH', 'DELETE'],
    allowedHeaders: ['authorization', 'content-type'],
    maxAge: 600,
  });

  // Authentication: every /v1 route except the local auth endpoints needs a valid bearer token.
  app.addHook('onRequest', async (req) => {
    const path = req.url.split('?')[0]!;
    if (!path.startsWith('/v1/') || path.startsWith('/v1/auth/')) return;
    const token = bearer(req.headers.authorization);
    if (!token) throw new ApiError(401, 'UNAUTHORIZED', 'Missing bearer token');
    const user = await deps.verifier.verify(token);
    req.userId = user.id;
  });

  // Per-user limits (per-IP before authentication). Runs after auth so the key is the user id.
  await app.register(rateLimit, {
    global: true,
    hook: 'preHandler',
    max: config.RATE_LIMIT_PER_MINUTE,
    timeWindow: '1 minute',
    keyGenerator: (req) => req.userId ?? `ip:${req.ip}`,
    errorResponseBuilder: (_req, ctx) => ({
      statusCode: 429,
      error: {
        code: 'RATE_LIMITED',
        message: `Too many requests, retry in ${Math.ceil(ctx.ttl / 1000)} s`,
      },
    }),
  });

  app.setErrorHandler((err, req, reply) => {
    const e = toApiError(err);
    if (e.status >= 500)
      req.log.error(
        { err: { message: (err as Error).message, code: (err as { code?: string }).code } },
        'request failed',
      );
    reply.status(e.status).send({
      error: {
        code: e.code,
        message: e.message,
        ...(e.details !== undefined ? { details: e.details } : {}),
      },
    });
  });
  app.setNotFoundHandler((_req, reply) => {
    reply.status(404).send({ error: { code: 'NOT_FOUND', message: 'Route not found' } });
  });

  app.get('/health', { config: { rateLimit: false } }, async () => ({ status: 'ok' }));
  app.get('/ready', { config: { rateLimit: false } }, async (_req, reply) => {
    const db = await ping(deps.pool);
    const body = { status: db ? 'ready' : 'degraded', database: db, ai: config.aiEnabled };
    return reply.status(db ? 200 : 503).send(body);
  });

  await registerRoutes(app, deps);
  return app;
}
