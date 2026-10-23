import { SignJWT } from 'jose';
import { randomUUID } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import { loadConfig } from '../config.js';
import { harness, TEST_DB } from './helpers.js';

const h = await harness();

describe('authentication', () => {
  it('rejects requests without a token', async () => {
    const r = await h.app.inject({ method: 'GET', url: '/v1/me' });
    expect(r.statusCode).toBe(401);
    expect(r.json().error.code).toBe('UNAUTHORIZED');
  });

  it('rejects malformed and foreign-signed tokens', async () => {
    const bad = await h.app.inject({
      method: 'GET',
      url: '/v1/me',
      headers: { authorization: 'Bearer not-a-jwt' },
    });
    expect(bad.statusCode).toBe(401);
    const forged = await new SignJWT({ role: 'authenticated' })
      .setProtectedHeader({ alg: 'HS256' })
      .setSubject(randomUUID())
      .setAudience('authenticated')
      .setIssuer('weight-ai-local')
      .setExpirationTime('1h')
      .sign(new TextEncoder().encode('another-secret-another-secret-12345'));
    const r = await h.app.inject({
      method: 'GET',
      url: '/v1/me',
      headers: { authorization: `Bearer ${forged}` },
    });
    expect(r.statusCode).toBe(401);
  });

  it('signs up, logs in and serves the new profile with defaults', async () => {
    const u = await h.signup();
    const me = await u.req('GET', '/v1/me');
    expect(me.status).toBe(200);
    expect(me.body).toMatchObject({
      id: u.id,
      timezone: 'UTC',
      weightUnit: 'kg',
      preferences: { language: 'ru', memoryEnabled: true },
    });
    const login = await h.app.inject({
      method: 'POST',
      url: '/v1/auth/local/login',
      payload: { email: u.email, password: 'password-123' },
    });
    expect(login.statusCode).toBe(200);
    expect(login.json().userId).toBe(u.id);
  });

  it('refuses a wrong password and a duplicate email', async () => {
    const u = await h.signup();
    const wrong = await h.app.inject({
      method: 'POST',
      url: '/v1/auth/local/login',
      payload: { email: u.email, password: 'wrong-password' },
    });
    expect(wrong.statusCode).toBe(401);
    const dup = await h.app.inject({
      method: 'POST',
      url: '/v1/auth/local/signup',
      payload: { email: u.email, password: 'password-123' },
    });
    expect(dup.statusCode).toBe(409);
  });

  it('refuses to start with local auth in production', () => {
    expect(() =>
      loadConfig({
        NODE_ENV: 'production',
        DATABASE_URL: TEST_DB,
        AUTH_PROVIDER: 'local',
        LOCAL_JWT_SECRET: 'x'.repeat(40),
      }),
    ).toThrow(/refused in production/);
  });

  it('health and readiness need no token', async () => {
    expect((await h.app.inject({ method: 'GET', url: '/health' })).statusCode).toBe(200);
    const ready = await h.app.inject({ method: 'GET', url: '/ready' });
    expect(ready.json()).toMatchObject({ status: 'ready', database: true, ai: true });
  });
});
