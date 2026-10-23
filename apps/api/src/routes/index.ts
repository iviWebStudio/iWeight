import {
  ChatRequestSchema,
  CreateGoalSchema,
  CreateMemorySchema,
  CreateWeightSchema,
  DeleteMeSchema,
  HistoryQuerySchema,
  ListWeightsQuerySchema,
  LocalAuthRequestSchema,
  PatchMeSchema,
  PatchMemorySchema,
  PatchWeightSchema,
  UuidSchema,
} from '@weight-ai/contracts';
import type { FastifyInstance, FastifyRequest } from 'fastify';
import { z } from 'zod';
import { runChat } from '../agent/runner.js';
import type { AppDeps } from '../app.js';
import { withUser, type Db } from '../db.js';
import { ApiError, notFound } from '../errors.js';
import { getHistory, getSummary } from '../services/analytics.js';
import { loadCtx, type UserCtx } from '../services/context.js';
import {
  deleteConversation,
  getConversation,
  listConversations,
} from '../services/conversations.js';
import { activeGoal, clearGoal, setGoal } from '../services/goals.js';
import { addMemory, deleteMemory, listMemory, updateMemory } from '../services/memory.js';
import { deleteAccount, getMe, patchMe } from '../services/profile.js';
import {
  createWeight,
  deleteWeight,
  getWeight,
  listWeights,
  updateWeight,
} from '../services/weights.js';

const IdParams = z.object({ id: UuidSchema });

export async function registerRoutes(app: FastifyInstance, deps: AppDeps): Promise<void> {
  const now = () => deps.now?.() ?? new Date();
  const uid = (req: FastifyRequest): string => {
    if (!req.userId) throw new ApiError(401, 'UNAUTHORIZED', 'Not authenticated');
    return req.userId;
  };
  /** Runs `fn` under RLS as the caller, with their profile context loaded. */
  const asUser = <T>(req: FastifyRequest, fn: (db: Db, ctx: UserCtx) => Promise<T>) =>
    withUser(deps.pool, uid(req), async (db) => fn(db, await loadCtx(db, uid(req), now())));
  // Unknown ids and other users' ids look identical: RLS hides the row, the API says 404.
  const id = (req: FastifyRequest) => {
    const p = IdParams.safeParse(req.params);
    if (!p.success) throw notFound();
    return p.data.id;
  };

  /* ---------------------------------------------------------- local auth (dev/CI only) */
  if (deps.localAuth) {
    const local = deps.localAuth;
    const strict = {
      config: {
        rateLimit: { max: deps.config.AUTH_RATE_LIMIT_PER_MINUTE, timeWindow: '1 minute' },
      },
    };
    app.post('/v1/auth/local/signup', strict, async (req, reply) => {
      const b = LocalAuthRequestSchema.parse(req.body);
      const r = await local.signup(b.email, b.password);
      return reply.status(201).send({
        accessToken: r.token,
        tokenType: 'bearer',
        expiresIn: local.ttlSeconds,
        userId: r.userId,
      });
    });
    app.post('/v1/auth/local/login', strict, async (req) => {
      const b = LocalAuthRequestSchema.parse(req.body);
      const r = await local.login(b.email, b.password);
      return {
        accessToken: r.token,
        tokenType: 'bearer',
        expiresIn: local.ttlSeconds,
        userId: r.userId,
      };
    });
  }

  /* ---------------------------------------------------------- me */
  app.get('/v1/me', async (req) => asUser(req, (db, ctx) => getMe(db, ctx.userId)));
  app.patch('/v1/me', async (req) => {
    const body = PatchMeSchema.parse(req.body);
    return withUser(deps.pool, uid(req), (db) => patchMe(db, uid(req), body));
  });
  app.delete('/v1/me', async (req, reply) => {
    DeleteMeSchema.parse(req.body);
    await withUser(deps.pool, uid(req), (db) => deleteAccount(db));
    return reply.status(204).send();
  });

  /* ---------------------------------------------------------- weights */
  app.get('/v1/weights', async (req) => {
    const q = ListWeightsQuerySchema.parse(req.query);
    return asUser(req, (db) => listWeights(db, q));
  });
  app.get('/v1/weights/:id', async (req) => asUser(req, (db) => getWeight(db, id(req))));
  app.post('/v1/weights', async (req, reply) => {
    const body = CreateWeightSchema.parse(req.body);
    const r = await asUser(req, (db, ctx) => createWeight(db, ctx, body));
    return reply.status(r.created ? 201 : 200).send(r.entry);
  });
  app.patch('/v1/weights/:id', async (req) => {
    const entryId = id(req);
    const body = PatchWeightSchema.parse(req.body);
    return asUser(req, (db, ctx) => updateWeight(db, ctx, entryId, body));
  });
  app.delete('/v1/weights/:id', async (req, reply) => {
    const entryId = id(req);
    await asUser(req, (db) => deleteWeight(db, entryId));
    return reply.status(204).send();
  });

  /* ---------------------------------------------------------- analytics */
  app.get('/v1/analytics/summary', async (req) =>
    asUser(req, async (db, ctx) => ({
      asOf: ctx.today,
      timezone: ctx.timezone,
      unit: ctx.unit,
      summary: await getSummary(db, ctx),
    })),
  );
  app.get('/v1/analytics/history', async (req) => {
    const q = HistoryQuerySchema.parse(req.query);
    return asUser(req, (db, ctx) => getHistory(db, ctx, q.from, q.to));
  });

  /* ---------------------------------------------------------- goals */
  app.get('/v1/goals/active', async (req) =>
    asUser(req, async (db) => ({ goal: await activeGoal(db) })),
  );
  app.post('/v1/goals', async (req, reply) => {
    const body = CreateGoalSchema.parse(req.body);
    return reply.status(201).send(await asUser(req, (db, ctx) => setGoal(db, ctx, body)));
  });
  app.delete('/v1/goals/active', async (req, reply) => {
    await asUser(req, (db) => clearGoal(db));
    return reply.status(204).send();
  });

  /* ---------------------------------------------------------- memory */
  app.get('/v1/memory', async (req) =>
    asUser(req, async (db) => ({ items: await listMemory(db) })),
  );
  app.post('/v1/memory', async (req, reply) => {
    const body = CreateMemorySchema.parse(req.body);
    return reply
      .status(201)
      .send(
        await asUser(req, (db, ctx) => addMemory(db, ctx.userId, body.kind, body.content, 'user')),
      );
  });
  app.patch('/v1/memory/:id', async (req) => {
    const memId = id(req);
    const body = PatchMemorySchema.parse(req.body);
    return asUser(req, (db) => updateMemory(db, memId, body));
  });
  app.delete('/v1/memory/:id', async (req, reply) => {
    const memId = id(req);
    await asUser(req, (db) => deleteMemory(db, memId));
    return reply.status(204).send();
  });

  /* ---------------------------------------------------------- chat */
  app.post(
    '/v1/chat',
    {
      config: {
        rateLimit: { max: deps.config.CHAT_RATE_LIMIT_PER_MINUTE, timeWindow: '1 minute' },
      },
    },
    async (req) => {
      const body = ChatRequestSchema.parse(req.body);
      return runChat(
        { pool: deps.pool, config: deps.config, model: deps.model, now: deps.now },
        uid(req),
        body,
      );
    },
  );
  app.get('/v1/conversations', async (req) =>
    asUser(req, async (db) => ({ items: await listConversations(db) })),
  );
  app.get('/v1/conversations/:id', async (req) =>
    asUser(req, (db) => getConversation(db, id(req))),
  );
  app.delete('/v1/conversations/:id', async (req, reply) => {
    const convId = id(req);
    await asUser(req, (db) => deleteConversation(db, convId));
    return reply.status(204).send();
  });
}
