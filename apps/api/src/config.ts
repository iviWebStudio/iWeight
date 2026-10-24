import { z } from 'zod';

const bool = z.enum(['true', 'false', '1', '0']).transform((v) => v === 'true' || v === '1');

const EnvSchema = z
  .object({
    NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),
    PORT: z.coerce.number().int().min(1).max(65535).default(4000),
    HOST: z.string().default('0.0.0.0'),
    DATABASE_URL: z.string().min(1),
    DATABASE_POOL_MAX: z.coerce.number().int().min(1).max(100).default(10),
    /** Supabase pooler: 'verify' with DATABASE_CA_CERT (PEM from the dashboard), or 'require'. */
    DATABASE_SSL: z.enum(['off', 'require', 'verify']).optional(),
    DATABASE_CA_CERT: z.string().optional(),
    AUTH_PROVIDER: z.enum(['supabase', 'local']).default('supabase'),
    LOCAL_JWT_SECRET: z.string().optional(),
    SUPABASE_URL: z
      .url()
      .optional()
      .or(z.literal('').transform(() => undefined)),
    /** Only for Supabase projects still on the legacy HS256 JWT secret. */
    SUPABASE_JWT_SECRET: z
      .string()
      .min(32)
      .optional()
      .or(z.literal('').transform(() => undefined)),
    OPENAI_API_KEY: z.string().optional(),
    OPENAI_MODEL: z.string().optional(),
    OPENAI_MAX_TOOL_ITERATIONS: z.coerce.number().int().min(1).max(20).default(6),
    OPENAI_TIMEOUT_MS: z.coerce.number().int().min(1000).max(300_000).default(30_000),
    /** Optional prices (USD per 1M tokens) for cost accounting; 0 means "not tracked". */
    OPENAI_PRICE_INPUT_PER_MTOK: z.coerce.number().min(0).default(0),
    OPENAI_PRICE_OUTPUT_PER_MTOK: z.coerce.number().min(0).default(0),
    CHAT_DAILY_TOKEN_BUDGET: z.coerce.number().int().min(0).default(200_000),
    CORS_ORIGINS: z.string().default(''),
    RATE_LIMIT_PER_MINUTE: z.coerce.number().int().min(1).default(120),
    CHAT_RATE_LIMIT_PER_MINUTE: z.coerce.number().int().min(1).default(12),
    AUTH_RATE_LIMIT_PER_MINUTE: z.coerce.number().int().min(1).default(10),
    TRUST_PROXY: bool.default(false),
    LOG_LEVEL: z
      .enum(['fatal', 'error', 'warn', 'info', 'debug', 'trace', 'silent'])
      .default('info'),
  })
  .superRefine((env, ctx) => {
    if (env.AUTH_PROVIDER === 'local') {
      if (env.NODE_ENV === 'production') {
        ctx.addIssue({
          code: 'custom',
          path: ['AUTH_PROVIDER'],
          message: 'local auth is refused in production (ADR-007)',
        });
      }
      if (!env.LOCAL_JWT_SECRET || env.LOCAL_JWT_SECRET.length < 32) {
        ctx.addIssue({
          code: 'custom',
          path: ['LOCAL_JWT_SECRET'],
          message: 'required, at least 32 characters',
        });
      }
    }
    if (env.DATABASE_SSL === 'verify' && !env.DATABASE_CA_CERT) {
      ctx.addIssue({
        code: 'custom',
        path: ['DATABASE_CA_CERT'],
        message: 'required when DATABASE_SSL=verify',
      });
    }
    if (env.AUTH_PROVIDER === 'supabase' && !env.SUPABASE_URL) {
      ctx.addIssue({
        code: 'custom',
        path: ['SUPABASE_URL'],
        message: 'required when AUTH_PROVIDER=supabase',
      });
    }
  });

export type Config = z.infer<typeof EnvSchema> & {
  corsOrigins: string[];
  aiEnabled: boolean;
  databaseSsl: 'off' | 'require' | 'verify';
};

export function loadConfig(env: Record<string, string | undefined> = process.env): Config {
  const parsed = EnvSchema.safeParse(env);
  if (!parsed.success) {
    const lines = parsed.error.issues.map((i) => `  ${i.path.join('.')}: ${i.message}`);
    throw new Error(`Invalid configuration:\n${lines.join('\n')}`);
  }
  const c = parsed.data;
  return {
    ...c,
    corsOrigins: c.CORS_ORIGINS.split(',')
      .map((s) => s.trim())
      .filter(Boolean),
    aiEnabled: Boolean(c.OPENAI_API_KEY && c.OPENAI_MODEL),
    // A CA certificate implies verification; otherwise local Postgres runs without TLS.
    databaseSsl: c.DATABASE_SSL ?? (c.DATABASE_CA_CERT ? 'verify' : 'off'),
  };
}
