/**
 * One chat turn. DB work happens in short RLS transactions; model calls happen outside them so a
 * slow model never holds a connection or a lock.
 *
 *   1. tx: idempotency check, conversation, store the user message, budget check, build context
 *   2. loop: model → tool calls (each in its own tx) → model … (bounded by max iterations)
 *   3. tx: store the reply and the agent_runs record (tokens, cost, tools, status)
 */
import { zonedTimeToUtc } from '@weight-ai/core';
import type { ChatRequest, ChatResponse, PendingAction, ToolEvent } from '@weight-ai/contracts';
import type pg from 'pg';
import type { Config } from '../config.js';
import { withUser, type Db } from '../db.js';
import { ApiError } from '../errors.js';
import { loadCtx, type UserCtx } from '../services/context.js';
import {
  addMessage,
  createConversation,
  findByClientMessageId,
  lockConversation,
  messageCount,
  messageRange,
  recentMessages,
  replyAfter,
  setPendingAction,
  setSummary,
  tokensUsedSince,
  touch,
  type ConversationState,
} from '../services/conversations.js';
import { listMemory } from '../services/memory.js';
import { getMe } from '../services/profile.js';
import type { InputItem, ModelClient } from './model.js';
import { mapOpenAIError } from './model.js';
import * as promptV1 from './prompts/v1.js';
import { executeTool, TOOL_NAMES, toolDefinitions, type ToolRunContext } from './tools.js';

export interface AgentDeps {
  pool: pg.Pool;
  config: Config;
  model: ModelClient | null;
  now?: () => Date;
}

/** How many most recent messages go to the model verbatim; older ones live in the summary. */
const RECENT_WINDOW = 20;
/** Summarize when this many messages are not yet covered by the summary. */
const SUMMARIZE_AFTER = 30;

interface AgentConfig {
  version: string;
  systemPrompt: string;
  model: string;
  allowedTools: string[];
  maxIterations: number;
}

const LANG = { ru: 'Russian', en: 'English', hy: 'Armenian' } as const;
const FORMAT = {
  brief: 'brief: 2–4 short lines, key numbers only',
  standard: 'standard: a short paragraph or a compact list',
  detailed: 'detailed: a structured list covering every metric the tool returned',
} as const;
const TONE = {
  neutral: 'neutral and factual',
  supportive: 'warm and encouraging, without exaggeration',
  concise: 'as short as possible',
} as const;

/** Active config row (operators manage it) or the version shipped in code. */
async function loadAgentConfig(db: Db, config: Config): Promise<AgentConfig> {
  const r = await db.query<{
    version: string;
    system_prompt: string;
    model_override: string | null;
    allowed_tools: string[];
    max_tool_iterations: number;
  }>(
    'select version, system_prompt, model_override, allowed_tools, max_tool_iterations from agent_config_versions where is_active',
  );
  const row = r.rows[0];
  const model = row?.model_override || config.OPENAI_MODEL!;
  if (row) {
    return {
      version: row.version,
      systemPrompt: row.system_prompt,
      model,
      allowedTools: row.allowed_tools.filter((t) => TOOL_NAMES.includes(t)),
      maxIterations: Math.min(row.max_tool_iterations, config.OPENAI_MAX_TOOL_ITERATIONS),
    };
  }
  return {
    version: promptV1.VERSION,
    systemPrompt: promptV1.SYSTEM_PROMPT,
    model,
    allowedTools: TOOL_NAMES,
    maxIterations: config.OPENAI_MAX_TOOL_ITERATIONS,
  };
}

interface Prepared {
  conversation: ConversationState;
  userMessageId: string;
  ctx: UserCtx;
  agent: AgentConfig;
  instructions: string;
  input: InputItem[];
  /** Set when a retried request already has a stored reply. */
  replay?: ChatResponse;
}

async function prepare(deps: AgentDeps, userId: string, req: ChatRequest): Promise<Prepared> {
  const now = deps.now?.() ?? new Date();
  return withUser(deps.pool, userId, async (db) => {
    const ctx = await loadCtx(db, userId, now);
    let conversation: ConversationState;
    let userMessageId: string;

    const existing = req.clientMessageId
      ? await findByClientMessageId(db, req.clientMessageId)
      : null;
    if (existing) {
      if (req.conversationId && req.conversationId !== existing.conversationId) {
        throw new ApiError(
          409,
          'CONFLICT',
          'clientMessageId was already used in another conversation',
        );
      }
      conversation = await lockConversation(db, existing.conversationId);
      const reply = await replyAfter(db, conversation.id, existing.message);
      if (reply) {
        return {
          conversation,
          userMessageId: existing.message.id,
          ctx,
          agent: null as unknown as AgentConfig,
          instructions: '',
          input: [],
          replay: {
            conversationId: conversation.id,
            userMessageId: existing.message.id,
            reply,
            pendingAction: conversation.pendingAction,
            limited: false,
          },
        };
      }
      userMessageId = existing.message.id; // earlier attempt failed before replying: run again
    } else {
      conversation = req.conversationId
        ? await lockConversation(db, req.conversationId)
        : await createConversation(db, userId, req.message.slice(0, 80));
      const m = await addMessage(db, {
        conversationId: conversation.id,
        userId,
        role: 'user',
        content: req.message,
        clientMessageId: req.clientMessageId,
      });
      userMessageId = m.id;
      await touch(db, conversation.id);
    }

    // Daily token budget per user, counted from midnight in the user's time zone.
    if (deps.config.CHAT_DAILY_TOKEN_BUDGET > 0) {
      const used = await tokensUsedSince(db, zonedTimeToUtc(ctx.today, '00:00', ctx.timezone));
      if (used >= deps.config.CHAT_DAILY_TOKEN_BUDGET) {
        throw new ApiError(
          429,
          'AI_BUDGET_EXCEEDED',
          'Daily AI usage limit reached. Your diary still works; the chat resets at midnight.',
        );
      }
    }

    // Expired confirmations are dropped so the model is never offered a stale one.
    if (conversation.pendingAction && new Date(conversation.pendingAction.expiresAt) <= now) {
      await setPendingAction(db, conversation.id, null);
      conversation.pendingAction = null;
    }

    const agent = await loadAgentConfig(db, deps.config);
    const me = await getMe(db, userId);
    const memory = me.preferences.memoryEnabled ? await listMemory(db) : [];
    const total = await messageCount(db, conversation.id);
    const unsummarized = Math.max(0, total - conversation.summaryMessageCount);
    const recent = await recentMessages(
      db,
      conversation.id,
      Math.min(RECENT_WINDOW, Math.max(unsummarized, 1)),
    );

    const instructions = buildInstructions(
      agent,
      ctx,
      me.preferences,
      memory.map((m) => `- (${m.kind}) ${m.content}`),
      conversation,
    );
    // Only this user's own messages; the current one is the last item.
    const input: InputItem[] = recent.map((m) => ({ role: m.role, content: m.content }));
    return { conversation, userMessageId, ctx, agent, instructions, input };
  });
}

function buildInstructions(
  agent: AgentConfig,
  ctx: UserCtx,
  prefs: {
    language: keyof typeof LANG;
    reportFormat: keyof typeof FORMAT;
    agentTone: keyof typeof TONE;
    memoryEnabled: boolean;
  },
  memory: string[],
  conversation: ConversationState,
): string {
  const parts = [
    agent.systemPrompt,
    '# User settings',
    `- Name: ${ctx.displayName ?? '(not set)'}`,
    `- Today: ${ctx.today} (time zone ${ctx.timezone})`,
    `- Weight unit: ${ctx.unit}`,
    `- Reply language: ${LANG[prefs.language]} (switch only if the user writes in another language)`,
    `- Report format: ${FORMAT[prefs.reportFormat]}`,
    `- Tone: ${TONE[prefs.agentTone]}`,
    '# Long-term memory (user-approved; never a source of weights or goals)',
    prefs.memoryEnabled
      ? memory.length
        ? memory.join('\n')
        : '(empty)'
      : '(memory is turned off by the user — do not save anything)',
  ];
  if (conversation.summary) {
    parts.push(
      '# Summary of earlier conversation (context only; not authoritative for any numbers)',
      conversation.summary,
    );
  }
  const p = conversation.pendingAction;
  if (p) {
    parts.push(
      '# Pending action awaiting confirmation',
      `Deletion of entry ${p.entryId} (${p.description}) was proposed earlier; confirmation_id=${p.confirmationId}, expires ${p.expiresAt}.`,
      'If the latest user message clearly confirms it, call delete_weight_entry with this entry_id and confirmation_id. If it declines or changes topic, do not delete.',
    );
  }
  return parts.join('\n');
}

interface RunOutcome {
  text: string;
  events: ToolEvent[];
  iterations: number;
  limited: boolean;
  inputTokens: number;
  outputTokens: number;
  pending: PendingAction | null;
}

async function loop(
  deps: AgentDeps,
  model: ModelClient,
  userId: string,
  p: Prepared,
  usage: { input: number; output: number },
): Promise<RunOutcome> {
  const tools = toolDefinitions(p.agent.allowedTools);
  const toolCtx: ToolRunContext = {
    pool: deps.pool,
    userId,
    conversationId: p.conversation.id,
    userMessageId: p.userMessageId,
    pending: p.conversation.pendingAction,
    now: deps.now ?? (() => new Date()),
  };
  const input = [...p.input];
  const events: ToolEvent[] = [];
  let iterations = 0;
  let text = '';
  let limited = false;
  while (true) {
    const atLimit = iterations >= p.agent.maxIterations;
    const res = await model.respond({
      model: p.agent.model,
      instructions: p.instructions,
      input,
      tools,
      toolChoice: atLimit ? 'none' : 'auto',
      maxOutputTokens: 1200,
    });
    usage.input += res.usage.inputTokens;
    usage.output += res.usage.outputTokens;
    iterations++;
    if (!res.functionCalls.length || atLimit) {
      text = res.text.trim();
      limited = atLimit;
      break;
    }
    input.push(...res.replay);
    for (const call of res.functionCalls) {
      const r = await executeTool(toolCtx, p.agent.allowedTools, call.name, call.arguments);
      events.push(r.event);
      input.push({ type: 'function_call_output', call_id: call.callId, output: r.output });
    }
  }
  if (!text) {
    text = limited
      ? 'Не удалось завершить запрос за отведённое число шагов. Уточните, пожалуйста, что именно сделать.'
      : 'Не удалось сформировать ответ. Попробуйте переформулировать.';
  }
  return {
    text,
    events,
    iterations,
    limited,
    inputTokens: usage.input,
    outputTokens: usage.output,
    pending: toolCtx.pending,
  };
}

function costMicros(config: Config, input: number, output: number): number {
  return Math.round(
    input * config.OPENAI_PRICE_INPUT_PER_MTOK + output * config.OPENAI_PRICE_OUTPUT_PER_MTOK,
  );
}

async function recordRun(
  deps: AgentDeps,
  userId: string,
  r: {
    conversationId: string | null;
    version: string | null;
    model: string;
    status: 'ok' | 'error' | 'limited';
    input: number;
    output: number;
    events: ToolEvent[];
    iterations: number;
    errorCode?: string;
    latencyMs: number;
  },
  db?: Db,
): Promise<void> {
  const sql = `insert into agent_runs (user_id, conversation_id, config_version, model, status, input_tokens, output_tokens,
      cost_usd_micros, tool_calls, iterations, error_code, latency_ms)
    values ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12)`;
  const vals = [
    userId,
    r.conversationId,
    r.version,
    r.model,
    r.status,
    r.input,
    r.output,
    costMicros(deps.config, r.input, r.output),
    JSON.stringify(r.events),
    r.iterations,
    r.errorCode ?? null,
    r.latencyMs,
  ];
  if (db) await db.query(sql, vals);
  else await withUser(deps.pool, userId, (d) => d.query(sql, vals));
}

export async function runChat(
  deps: AgentDeps,
  userId: string,
  req: ChatRequest,
): Promise<ChatResponse> {
  if (!deps.config.aiEnabled || !deps.model) {
    throw new ApiError(
      503,
      'AI_NOT_CONFIGURED',
      'The AI assistant is not configured on this server (OPENAI_API_KEY / OPENAI_MODEL)',
    );
  }
  const model = deps.model;
  const started = Date.now();
  const p = await prepare(deps, userId, req);
  if (p.replay) return p.replay;

  const usage = { input: 0, output: 0 };
  let out: RunOutcome;
  try {
    out = await loop(deps, model, userId, p, usage);
  } catch (e) {
    const err = mapOpenAIError(e);
    await recordRun(deps, userId, {
      conversationId: p.conversation.id,
      version: p.agent.version,
      model: p.agent.model,
      status: 'error',
      input: usage.input,
      output: usage.output,
      events: [],
      iterations: 0,
      errorCode: (err.details as { reason?: string } | undefined)?.reason ?? err.code,
      latencyMs: Date.now() - started,
    }).catch(() => undefined);
    throw err;
  }

  const result = await withUser(deps.pool, userId, async (db) => {
    const reply = await addMessage(db, {
      conversationId: p.conversation.id,
      userId,
      role: 'assistant',
      content: out.text,
      toolEvents: out.events,
    });
    await recordRun(
      deps,
      userId,
      {
        conversationId: p.conversation.id,
        version: p.agent.version,
        model: p.agent.model,
        status: out.limited ? 'limited' : 'ok',
        input: out.inputTokens,
        output: out.outputTokens,
        events: out.events,
        iterations: out.iterations,
        latencyMs: Date.now() - started,
      },
      db,
    );
    await touch(db, p.conversation.id);
    return reply;
  });

  // Best effort; a failure here never affects the answer the user gets.
  await maybeSummarize(deps, model, userId, p).catch(() => undefined);

  return {
    conversationId: p.conversation.id,
    userMessageId: p.userMessageId,
    reply: result,
    pendingAction: out.pending,
    limited: out.limited,
  };
}

/** Memory level 6: folds older messages into conversations.summary. */
async function maybeSummarize(
  deps: AgentDeps,
  model: ModelClient,
  userId: string,
  p: Prepared,
): Promise<void> {
  const plan = await withUser(deps.pool, userId, async (db) => {
    const total = await messageCount(db, p.conversation.id);
    const upTo = total - RECENT_WINDOW;
    if (upTo - p.conversation.summaryMessageCount < SUMMARIZE_AFTER) return null;
    const older = await messageRange(
      db,
      p.conversation.id,
      p.conversation.summaryMessageCount,
      upTo,
    );
    return { upTo, older };
  });
  if (!plan) return;
  const transcript = plan.older
    .map((m) => `${m.role}: ${m.content}`)
    .join('\n')
    .slice(0, 30_000);
  const res = await model.respond({
    model: p.agent.model,
    instructions:
      'Update the running summary of a conversation between a user and their weight-diary assistant. Keep durable context: what the user asked for, decisions, preferences, open questions. Do NOT record weights, dates of measurements, goals or statistics — those are read from the database. Max 1200 characters, plain text, in the conversation language.',
    input: [
      {
        role: 'user',
        content: `Current summary:\n${p.conversation.summary ?? '(none)'}\n\nNew messages:\n${transcript}`,
      },
    ],
    tools: [],
    toolChoice: 'none',
    maxOutputTokens: 600,
  });
  const summary = res.text.trim();
  await withUser(deps.pool, userId, async (db) => {
    if (summary) await setSummary(db, p.conversation.id, summary, plan.upTo);
    await recordRun(
      deps,
      userId,
      {
        conversationId: p.conversation.id,
        version: `${p.agent.version}:summary`,
        model: p.agent.model,
        status: 'ok',
        input: res.usage.inputTokens,
        output: res.usage.outputTokens,
        events: [],
        iterations: 1,
        latencyMs: 0,
      },
      db,
    );
  });
}
