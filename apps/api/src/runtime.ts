import type { FastifyInstance } from 'fastify';
import type pg from 'pg';
import { openAIModelClient } from './agent/model.js';
import { buildApp } from './app.js';
import { createVerifier } from './auth.js';
import type { Config } from './config.js';
import { createPool } from './db.js';

/** Wires config → pool, auth, model and the app. Shared by the long-running server and Vercel. */
export async function createRuntime(
  config: Config,
  poolMax = config.DATABASE_POOL_MAX,
): Promise<{ app: FastifyInstance; pool: pg.Pool }> {
  const pool = createPool(config.DATABASE_URL, {
    max: poolMax,
    ssl: config.databaseSsl,
    // Env UIs sometimes store a PEM with literal "\n".
    caCert: config.DATABASE_CA_CERT?.replace(/\\n/g, '\n'),
  });
  const { verifier, local } = createVerifier(config, pool);
  const model = config.aiEnabled
    ? openAIModelClient(config.OPENAI_API_KEY!, config.OPENAI_TIMEOUT_MS)
    : null;
  const app = await buildApp({ config, pool, verifier, localAuth: local, model });
  if (!config.aiEnabled)
    app.log.warn('OPENAI_API_KEY / OPENAI_MODEL not set: /v1/chat answers 503 AI_NOT_CONFIGURED');
  if (config.AUTH_PROVIDER === 'local') app.log.warn('AUTH_PROVIDER=local — development only');
  return { app, pool };
}
