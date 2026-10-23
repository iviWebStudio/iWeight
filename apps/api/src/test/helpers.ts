import { randomUUID } from 'node:crypto';
import type { FastifyInstance } from 'fastify';
import pg from 'pg';
import OpenAI from 'openai';
import { afterAll, afterEach, expect } from 'vitest';
import type { FunctionCall, ModelClient, ModelRequest, ModelResult } from '../agent/model.js';
import { buildApp } from '../app.js';
import { createVerifier } from '../auth.js';
import { loadConfig, type Config } from '../config.js';

export const TEST_DB =
  process.env.TEST_DATABASE_URL ??
  'postgres://weight_api:weight_api_local@localhost:5432/weight_ai_test';
export const SECRET = 'test-secret-test-secret-test-secret-0123';

export function testConfig(over: Record<string, string> = {}): Config {
  return loadConfig({
    NODE_ENV: 'test',
    DATABASE_URL: TEST_DB,
    AUTH_PROVIDER: 'local',
    LOCAL_JWT_SECRET: SECRET,
    OPENAI_API_KEY: 'sk-test',
    OPENAI_MODEL: 'test-model',
    LOG_LEVEL: 'silent',
    RATE_LIMIT_PER_MINUTE: '10000',
    CHAT_RATE_LIMIT_PER_MINUTE: '10000',
    AUTH_RATE_LIMIT_PER_MINUTE: '10000',
    ...over,
  });
}

/* ------------------------------------------------------------ scripted model */

export type Step = (req: ModelRequest) => Partial<ModelResult> | Promise<Partial<ModelResult>>;

/** Plays steps in order; records every request so tests can assert on context and tool outputs. */
export class ScriptedModel implements ModelClient {
  readonly requests: ModelRequest[] = [];
  steps: Step[] = [];
  fallback: Step | null = null;
  /** Assertion failures inside steps. The server would turn them into a 503, hiding them. */
  readonly failures: unknown[] = [];
  script(...steps: Step[]): this {
    this.steps.push(...steps);
    return this;
  }
  async respond(req: ModelRequest): Promise<ModelResult> {
    this.requests.push(structuredClone(req));
    const step = this.steps.shift() ?? this.fallback;
    if (!step) throw new Error('ScriptedModel: no step left');
    let r: Partial<ModelResult>;
    try {
      r = await step(req);
    } catch (e) {
      if (!(e instanceof OpenAI.APIError)) this.failures.push(e);
      throw e;
    }
    const calls = r.functionCalls ?? [];
    return {
      text: r.text ?? '',
      functionCalls: calls,
      replay:
        r.replay ??
        calls.map((c) => ({
          type: 'function_call',
          call_id: c.callId,
          name: c.name,
          arguments: c.arguments,
        })),
      usage: r.usage ?? { inputTokens: 100, outputTokens: 20 },
    };
  }
}

export const call = (name: string, args: Record<string, unknown> = {}): FunctionCall => ({
  callId: `call_${randomUUID().slice(0, 8)}`,
  name,
  arguments: JSON.stringify(args),
});
export const tools =
  (...calls: FunctionCall[]): Step =>
  () => ({ functionCalls: calls });
export const say =
  (text: string): Step =>
  () => ({ text });

/** Parsed outputs of the tool calls sent back to the model in a request. */
export function toolOutputs(req: ModelRequest): Array<Record<string, unknown>> {
  return req.input
    .filter(
      (i): i is { type: 'function_call_output'; call_id: string; output: string } =>
        (i as { type?: string }).type === 'function_call_output',
    )
    .map((i) => JSON.parse(i.output) as Record<string, unknown>);
}

/* ------------------------------------------------------------ app harness */

export interface Harness {
  app: FastifyInstance;
  pool: pg.Pool;
  model: ScriptedModel;
  config: Config;
  now: { value: Date };
  signup(): Promise<User>;
}

export interface User {
  id: string;
  token: string;
  email: string;
  req(method: string, url: string, body?: unknown): Promise<{ status: number; body: any }>;
}

export async function harness(
  over: Record<string, string> = {},
  withModel = true,
): Promise<Harness> {
  const config = testConfig(over);
  const pool = new pg.Pool({ connectionString: config.DATABASE_URL, max: 5 });
  const { verifier, local } = createVerifier(config, pool);
  const model = new ScriptedModel();
  const now = { value: new Date() };
  const app = await buildApp({
    config,
    pool,
    verifier,
    localAuth: local,
    model: withModel ? model : null,
    now: () => now.value,
  });
  const created: string[] = [];

  afterEach(() => {
    const failures = model.failures.splice(0);
    expect(failures, 'assertion failed inside a scripted model step').toEqual([]);
    expect(model['steps'], 'unused scripted model steps').toEqual([]);
  });

  afterAll(async () => {
    await app.close();
    if (created.length)
      await pool.query('delete from auth.users where id = any($1::uuid[])', [created]);
    await pool.end();
  });

  async function signup(): Promise<User> {
    const email = `u-${randomUUID()}@test.local`;
    const r = await app.inject({
      method: 'POST',
      url: '/v1/auth/local/signup',
      payload: { email, password: 'password-123' },
    });
    if (r.statusCode !== 201) throw new Error(`signup failed: ${r.body}`);
    const { accessToken, userId } = r.json() as { accessToken: string; userId: string };
    created.push(userId);
    return {
      id: userId,
      token: accessToken,
      email,
      async req(method, url, body) {
        const res = await app.inject({
          method: method as 'GET',
          url,
          headers: { authorization: `Bearer ${accessToken}` },
          ...(body !== undefined ? { payload: body as object } : {}),
        });
        return { status: res.statusCode, body: res.body ? res.json() : null };
      },
    };
  }
  return { app, pool, model, config, now, signup };
}

export const kg = (v: number) => Math.round(v * 1000);
