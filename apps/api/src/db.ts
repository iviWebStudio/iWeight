import pg from 'pg';

export type Db = pg.PoolClient;

export interface PoolOptions {
  max?: number;
  /** 'off' for local Postgres; 'verify' checks the server certificate against `caCert`. */
  ssl?: 'off' | 'require' | 'verify';
  caCert?: string;
}

export function createPool(connectionString: string, o: PoolOptions = {}): pg.Pool {
  const ssl =
    o.ssl === 'verify'
      ? { ca: o.caCert, rejectUnauthorized: true }
      : o.ssl === 'require'
        ? { rejectUnauthorized: false } // encrypted, certificate not checked
        : undefined;
  return new pg.Pool({
    connectionString,
    max: o.max ?? 10,
    ssl,
    idleTimeoutMillis: 30_000,
    connectionTimeoutMillis: 5_000,
  });
}
// `date` columns stay as 'YYYY-MM-DD' strings (calendar dates, ADR-003).
pg.types.setTypeParser(1082, (v) => v);
// bigint (cost) fits comfortably in a JS number at our scale.
pg.types.setTypeParser(20, (v) => Number(v));

/**
 * Runs `fn` in a transaction as the `authenticated` role with `auth.uid() = userId`.
 * Every query inside is subject to RLS (ADR-005): a bug in the API cannot read or write
 * another user's rows.
 */
export async function withUser<T>(
  pool: pg.Pool,
  userId: string,
  fn: (db: Db) => Promise<T>,
): Promise<T> {
  const client = await pool.connect();
  try {
    await client.query('begin');
    await client.query('set local role authenticated');
    await client.query(`select set_config('request.jwt.claims', $1, true)`, [
      JSON.stringify({ sub: userId, role: 'authenticated' }),
    ]);
    const result = await fn(client);
    await client.query('commit');
    return result;
  } catch (err) {
    await client.query('rollback').catch(() => undefined);
    throw err;
  } finally {
    client.release();
  }
}

export async function ping(pool: pg.Pool): Promise<boolean> {
  try {
    await pool.query('select 1');
    return true;
  } catch {
    return false;
  }
}
