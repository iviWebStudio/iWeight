import { openAIModelClient } from './agent/model.js';
import { buildApp } from './app.js';
import { createVerifier } from './auth.js';
import { loadConfig } from './config.js';
import { createPool } from './db.js';

const config = loadConfig();
const pool = createPool(config.DATABASE_URL, config.DATABASE_POOL_MAX);
const { verifier, local } = createVerifier(config, pool);
const model = config.aiEnabled
  ? openAIModelClient(config.OPENAI_API_KEY!, config.OPENAI_TIMEOUT_MS)
  : null;
const app = await buildApp({ config, pool, verifier, localAuth: local, model });

if (!config.aiEnabled)
  app.log.warn('OPENAI_API_KEY / OPENAI_MODEL not set: /v1/chat answers 503 AI_NOT_CONFIGURED');
if (config.AUTH_PROVIDER === 'local') app.log.warn('AUTH_PROVIDER=local — development only');

const shutdown = async (signal: string) => {
  app.log.info({ signal }, 'shutting down');
  await app.close();
  await pool.end();
  process.exit(0);
};
process.on('SIGTERM', () => void shutdown('SIGTERM'));
process.on('SIGINT', () => void shutdown('SIGINT'));

await app.listen({ port: config.PORT, host: config.HOST });
