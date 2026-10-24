/**
 * Vercel entry: one Fastify instance per warm function instance, fed raw Node requests.
 * The pool stays small — the Supabase transaction pooler does the real pooling.
 */
import type { IncomingMessage, ServerResponse } from 'node:http';
import type { FastifyInstance } from 'fastify';
import { loadConfig } from './config.js';
import { createRuntime } from './runtime.js';

let ready: Promise<FastifyInstance> | null = null;

function getApp(): Promise<FastifyInstance> {
  ready ??= (async () => {
    const { app } = await createRuntime(loadConfig(), 3);
    await app.ready();
    return app;
  })().catch((e: unknown) => {
    ready = null; // let the next request retry after a bad start (e.g. config error)
    throw e;
  });
  return ready;
}

export default async function handler(req: IncomingMessage, res: ServerResponse): Promise<void> {
  let app: FastifyInstance;
  try {
    app = await getApp();
  } catch (e) {
    console.error('API failed to start:', e instanceof Error ? e.message : e);
    res.statusCode = 500;
    res.setHeader('content-type', 'application/json');
    res.end(JSON.stringify({ error: { code: 'INTERNAL', message: 'Server misconfigured' } }));
    return;
  }
  app.server.emit('request', req, res);
}
