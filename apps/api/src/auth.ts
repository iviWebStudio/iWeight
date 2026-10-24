import {
  createRemoteJWKSet,
  decodeProtectedHeader,
  jwtVerify,
  SignJWT,
  type JWTPayload,
} from 'jose';
import { randomBytes, scrypt as scryptCb, timingSafeEqual } from 'node:crypto';
import { promisify } from 'node:util';
import type pg from 'pg';
import { ApiError } from './errors.js';
import type { Config } from './config.js';

const scrypt = promisify(scryptCb) as (pw: string, salt: Buffer, len: number) => Promise<Buffer>;

export interface AuthUser {
  id: string;
}

export interface AuthVerifier {
  verify(token: string): Promise<AuthUser>;
}

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

function userFromPayload(p: JWTPayload): AuthUser {
  if (typeof p.sub !== 'string' || !UUID_RE.test(p.sub))
    throw new ApiError(401, 'UNAUTHORIZED', 'Invalid token subject');
  return { id: p.sub.toLowerCase() };
}

/**
 * Supabase access tokens (ADR-007). Projects on asymmetric JWT signing keys are verified against
 * the public JWKS; projects still on the legacy shared secret (HS256) need `jwtSecret`.
 * Both paths check issuer, audience, expiry and the algorithm.
 */
export function supabaseVerifier(supabaseUrl: string, jwtSecret?: string): AuthVerifier {
  const base = supabaseUrl.replace(/\/$/, '');
  const jwks = createRemoteJWKSet(new URL(`${base}/auth/v1/.well-known/jwks.json`));
  const secret = jwtSecret ? new TextEncoder().encode(jwtSecret) : null;
  const opts = { audience: 'authenticated', issuer: `${base}/auth/v1` };
  return {
    async verify(token) {
      try {
        const { alg } = decodeProtectedHeader(token);
        const { payload } =
          alg === 'HS256'
            ? secret
              ? await jwtVerify(token, secret, { ...opts, algorithms: ['HS256'] })
              : (() => {
                  throw new Error('HS256 token but SUPABASE_JWT_SECRET is not set');
                })()
            : await jwtVerify(token, jwks, { ...opts, algorithms: ['ES256', 'RS256', 'EdDSA'] });
        return userFromPayload(payload);
      } catch (e) {
        if (e instanceof ApiError) throw e;
        throw new ApiError(401, 'UNAUTHORIZED', 'Invalid or expired token');
      }
    },
  };
}

const LOCAL_ISSUER = 'weight-ai-local';
const LOCAL_TTL_S = 60 * 60 * 12;

/** Development/CI only: HS256 tokens of the same shape as Supabase's. Refused in production by config. */
export function localAuth(secret: string, pool: pg.Pool) {
  const key = new TextEncoder().encode(secret);
  const sign = (userId: string) =>
    new SignJWT({ role: 'authenticated' })
      .setProtectedHeader({ alg: 'HS256' })
      .setSubject(userId)
      .setAudience('authenticated')
      .setIssuer(LOCAL_ISSUER)
      .setIssuedAt()
      .setExpirationTime(`${LOCAL_TTL_S}s`)
      .sign(key);

  async function hash(password: string): Promise<string> {
    const salt = randomBytes(16);
    const h = await scrypt(password, salt, 32);
    return `scrypt$${salt.toString('base64')}$${h.toString('base64')}`;
  }
  async function check(password: string, stored: string | null): Promise<boolean> {
    const [kind, s, h] = (stored ?? '').split('$');
    if (kind !== 'scrypt' || !s || !h) return false;
    const expected = Buffer.from(h, 'base64');
    const actual = await scrypt(password, Buffer.from(s, 'base64'), expected.length);
    return timingSafeEqual(expected, actual);
  }

  const verifier: AuthVerifier = {
    async verify(token) {
      try {
        const { payload } = await jwtVerify(token, key, {
          audience: 'authenticated',
          issuer: LOCAL_ISSUER,
          algorithms: ['HS256'],
        });
        return userFromPayload(payload);
      } catch (e) {
        if (e instanceof ApiError) throw e;
        throw new ApiError(401, 'UNAUTHORIZED', 'Invalid or expired token');
      }
    },
  };

  return {
    verifier,
    ttlSeconds: LOCAL_TTL_S,
    async signup(email: string, password: string) {
      const res = await pool.query<{ id: string }>(
        `insert into auth.users (email, encrypted_password) values (lower($1), $2)
         on conflict (email) do nothing returning id`,
        [email, await hash(password)],
      );
      const row = res.rows[0];
      if (!row) throw new ApiError(409, 'CONFLICT', 'Email already registered');
      return { userId: row.id, token: await sign(row.id) };
    },
    async login(email: string, password: string) {
      const res = await pool.query<{ id: string; encrypted_password: string | null }>(
        'select id, encrypted_password from auth.users where email = lower($1)',
        [email],
      );
      const row = res.rows[0];
      // Same work and same answer whether or not the email exists.
      const ok = await check(
        password,
        row?.encrypted_password ??
          'scrypt$AAAAAAAAAAAAAAAAAAAAAA==$AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA=',
      );
      if (!row || !ok) throw new ApiError(401, 'UNAUTHORIZED', 'Wrong email or password');
      return { userId: row.id, token: await sign(row.id) };
    },
    sign,
  };
}
export type LocalAuth = ReturnType<typeof localAuth>;

export function bearer(header: string | undefined): string | null {
  if (!header) return null;
  const m = /^Bearer\s+(\S+)$/i.exec(header);
  return m ? m[1]! : null;
}

export function createVerifier(
  config: Config,
  pool: pg.Pool,
): { verifier: AuthVerifier; local: LocalAuth | null } {
  if (config.AUTH_PROVIDER === 'local') {
    const local = localAuth(config.LOCAL_JWT_SECRET!, pool);
    return { verifier: local.verifier, local };
  }
  return {
    verifier: supabaseVerifier(config.SUPABASE_URL!, config.SUPABASE_JWT_SECRET),
    local: null,
  };
}
