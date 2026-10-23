import type {
  ChatMessage,
  Conversation,
  ConversationDetail,
  PendingAction,
  ToolEvent,
} from '@weight-ai/contracts';
import { PendingActionSchema } from '@weight-ai/contracts';
import type { Db } from '../db.js';
import { notFound } from '../errors.js';
import { isoReq } from './context.js';

interface ConvRow {
  id: string;
  title: string | null;
  summary: string | null;
  summary_message_count: number;
  pending_action: unknown;
  created_at: Date;
  updated_at: Date;
}
interface MsgRow {
  id: string;
  role: 'user' | 'assistant';
  content: string;
  tool_events: ToolEvent[] | null;
  client_message_id: string | null;
  created_at: Date;
}

export interface ConversationState {
  id: string;
  title: string | null;
  summary: string | null;
  summaryMessageCount: number;
  pendingAction: PendingAction | null;
}

const toMsg = (r: MsgRow): ChatMessage => ({
  id: r.id,
  role: r.role,
  content: r.content,
  toolEvents: r.tool_events,
  createdAt: isoReq(r.created_at),
});

function parsePending(v: unknown): PendingAction | null {
  const p = PendingActionSchema.safeParse(v);
  return p.success ? p.data : null;
}

export async function createConversation(
  db: Db,
  userId: string,
  title: string | null,
): Promise<ConversationState> {
  const r = await db.query<ConvRow>(
    'insert into conversations (user_id, title) values ($1, $2) returning *',
    [userId, title],
  );
  return toState(r.rows[0]!);
}

function toState(r: ConvRow): ConversationState {
  return {
    id: r.id,
    title: r.title,
    summary: r.summary,
    summaryMessageCount: r.summary_message_count,
    pendingAction: parsePending(r.pending_action),
  };
}

/** Locks the conversation row so two concurrent turns in one conversation run one after another. */
export async function lockConversation(db: Db, id: string): Promise<ConversationState> {
  const r = await db.query<ConvRow>('select * from conversations where id = $1 for update', [id]);
  if (!r.rows[0]) throw notFound('Conversation');
  return toState(r.rows[0]);
}

export async function setPendingAction(db: Db, id: string, p: PendingAction | null): Promise<void> {
  await db.query('update conversations set pending_action = $2 where id = $1', [
    id,
    p ? JSON.stringify(p) : null,
  ]);
}

export async function setSummary(
  db: Db,
  id: string,
  summary: string,
  count: number,
): Promise<void> {
  await db.query(
    'update conversations set summary = $2, summary_message_count = $3 where id = $1',
    [id, summary.slice(0, 4000), count],
  );
}

export async function touch(db: Db, id: string): Promise<void> {
  await db.query('update conversations set title = title where id = $1', [id]);
}

export async function addMessage(
  db: Db,
  m: {
    conversationId: string;
    userId: string;
    role: 'user' | 'assistant';
    content: string;
    toolEvents?: ToolEvent[] | null;
    clientMessageId?: string | null;
  },
): Promise<ChatMessage> {
  const r = await db.query<MsgRow>(
    // clock_timestamp(): a user message and its reply share one transaction, so now() would tie.
    `insert into messages (conversation_id, user_id, role, content, tool_events, client_message_id, created_at)
     values ($1, $2, $3, $4, $5, $6, clock_timestamp()) returning id, role, content, tool_events, client_message_id, created_at`,
    [
      m.conversationId,
      m.userId,
      m.role,
      m.content.slice(0, 8000),
      m.toolEvents ? JSON.stringify(m.toolEvents) : null,
      m.clientMessageId ?? null,
    ],
  );
  return toMsg(r.rows[0]!);
}

export async function findByClientMessageId(
  db: Db,
  clientMessageId: string,
): Promise<{ conversationId: string; message: ChatMessage } | null> {
  const r = await db.query<MsgRow & { conversation_id: string }>(
    'select id, conversation_id, role, content, tool_events, client_message_id, created_at from messages where client_message_id = $1',
    [clientMessageId],
  );
  const row = r.rows[0];
  return row ? { conversationId: row.conversation_id, message: toMsg(row) } : null;
}

/** The assistant message stored right after a given user message, if any. */
export async function replyAfter(
  db: Db,
  conversationId: string,
  userMessage: ChatMessage,
): Promise<ChatMessage | null> {
  const r = await db.query<MsgRow>(
    `select id, role, content, tool_events, client_message_id, created_at from messages
      where conversation_id = $1 and created_at >= $2 and id <> $3
      order by created_at limit 1`,
    [conversationId, userMessage.createdAt, userMessage.id],
  );
  const row = r.rows[0];
  return row && row.role === 'assistant' ? toMsg(row) : null;
}

export async function recentMessages(
  db: Db,
  conversationId: string,
  limit: number,
): Promise<ChatMessage[]> {
  const r = await db.query<MsgRow>(
    `select * from (select id, role, content, tool_events, client_message_id, created_at from messages
      where conversation_id = $1 order by created_at desc limit $2) t order by created_at`,
    [conversationId, limit],
  );
  return r.rows.map(toMsg);
}

export async function messageCount(db: Db, conversationId: string): Promise<number> {
  const r = await db.query<{ n: number }>(
    'select count(*)::int as n from messages where conversation_id = $1',
    [conversationId],
  );
  return r.rows[0]?.n ?? 0;
}

/** Messages in positions [from, to) of the conversation, oldest first. */
export async function messageRange(
  db: Db,
  conversationId: string,
  from: number,
  to: number,
): Promise<ChatMessage[]> {
  const r = await db.query<MsgRow>(
    `select id, role, content, tool_events, client_message_id, created_at from messages
      where conversation_id = $1 order by created_at offset $2 limit $3`,
    [conversationId, from, Math.max(0, to - from)],
  );
  return r.rows.map(toMsg);
}

export async function listConversations(db: Db): Promise<Conversation[]> {
  const r = await db.query<ConvRow>(
    'select * from conversations order by updated_at desc limit 100',
  );
  return r.rows.map((x) => ({
    id: x.id,
    title: x.title,
    createdAt: isoReq(x.created_at),
    updatedAt: isoReq(x.updated_at),
  }));
}

export async function getConversation(db: Db, id: string): Promise<ConversationDetail> {
  const r = await db.query<ConvRow>('select * from conversations where id = $1', [id]);
  const c = r.rows[0];
  if (!c) throw notFound('Conversation');
  const msgs = await db.query<MsgRow>(
    'select id, role, content, tool_events, client_message_id, created_at from messages where conversation_id = $1 order by created_at',
    [id],
  );
  return {
    id: c.id,
    title: c.title,
    createdAt: isoReq(c.created_at),
    updatedAt: isoReq(c.updated_at),
    messages: msgs.rows.map(toMsg),
    pendingAction: parsePending(c.pending_action),
  };
}

export async function deleteConversation(db: Db, id: string): Promise<void> {
  const r = await db.query('delete from conversations where id = $1', [id]);
  if (r.rowCount === 0) throw notFound('Conversation');
}

export async function tokensUsedSince(db: Db, since: Date): Promise<number> {
  const r = await db.query<{ n: number }>(
    'select coalesce(sum(input_tokens + output_tokens), 0)::int as n from agent_runs where created_at >= $1',
    [since],
  );
  return r.rows[0]?.n ?? 0;
}
