import type { MemoryItem } from '@weight-ai/contracts';
import type { Db } from '../db.js';
import { ApiError, notFound } from '../errors.js';
import { isoReq } from './context.js';

interface Row {
  id: string;
  kind: MemoryItem['kind'];
  content: string;
  source: MemoryItem['source'];
  created_at: Date;
  updated_at: Date;
}
const COLS = 'id, kind, content, source, created_at, updated_at';
const toItem = (r: Row): MemoryItem => ({
  id: r.id,
  kind: r.kind,
  content: r.content,
  source: r.source,
  createdAt: isoReq(r.created_at),
  updatedAt: isoReq(r.updated_at),
});

export const MEMORY_LIMIT = 100;

export async function listMemory(db: Db): Promise<MemoryItem[]> {
  const r = await db.query<Row>(`select ${COLS} from agent_memory order by created_at`);
  return r.rows.map(toItem);
}

export async function addMemory(
  db: Db,
  userId: string,
  kind: MemoryItem['kind'],
  content: string,
  source: MemoryItem['source'],
): Promise<MemoryItem> {
  const n = await db.query<{ n: number }>('select count(*)::int as n from agent_memory');
  if ((n.rows[0]?.n ?? 0) >= MEMORY_LIMIT) {
    throw new ApiError(
      409,
      'CONFLICT',
      `Memory is full (${MEMORY_LIMIT} items). Delete something first.`,
    );
  }
  const r = await db.query<Row>(
    `insert into agent_memory (user_id, kind, content, source) values ($1, $2, $3, $4) returning ${COLS}`,
    [userId, kind, content, source],
  );
  return toItem(r.rows[0]!);
}

export async function updateMemory(
  db: Db,
  id: string,
  patch: { kind?: MemoryItem['kind']; content?: string },
): Promise<MemoryItem> {
  const r = await db.query<Row>(
    `update agent_memory set kind = coalesce($2, kind), content = coalesce($3, content) where id = $1 returning ${COLS}`,
    [id, patch.kind ?? null, patch.content ?? null],
  );
  if (!r.rows[0]) throw notFound('Memory item');
  return toItem(r.rows[0]);
}

export async function deleteMemory(db: Db, id: string): Promise<void> {
  const r = await db.query('delete from agent_memory where id = $1', [id]);
  if (r.rowCount === 0) throw notFound('Memory item');
}
