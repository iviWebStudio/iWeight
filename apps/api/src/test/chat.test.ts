import { randomUUID } from 'node:crypto';
import { addDays, localDateInTimeZone } from '@weight-ai/core';
import OpenAI from 'openai';
import { describe, expect, it } from 'vitest';
import { mapOpenAIError } from '../agent/model.js';
import { toolDefinitions, TOOL_NAMES } from '../agent/tools.js';
import { zonedTimeToUtc } from '../agent/time.js';
import { withUser } from '../db.js';
import { call, harness, kg, say, toolOutputs, tools } from './helpers.js';

const h = await harness({ OPENAI_MAX_TOOL_ITERATIONS: '3', CHAT_DAILY_TOKEN_BUDGET: '5000' });
const today = () => localDateInTimeZone(new Date(), 'UTC');

async function runs(userId: string) {
  return withUser(
    h.pool,
    userId,
    async (db) => (await db.query('select * from agent_runs order by created_at')).rows,
  );
}

describe('agent: recording and reading data through tools', () => {
  it('records a weight only via the tool and replies with server-computed numbers', async () => {
    const u = await h.signup();
    await u.req('POST', '/v1/weights', { weightG: kg(81), measuredOn: addDays(today(), -1) });
    h.model.script(tools(call('add_weight_entry', { weight: 80.6 })), (req) => {
      const [out] = toolOutputs(req);
      expect(out).toMatchObject({
        ok: true,
        outcome: 'created',
        entry: { weight: '80.6 kg', date: today() },
        isMorningValueForDay: true,
        changeSincePreviousMorning: { display: '−0.4 kg' },
      });
      return {
        text: `Записал 80,6 кг. ${String((out as { changeSincePreviousMorning: { display: string } }).changeSincePreviousMorning.display)} ко вчера.`,
      };
    });
    const r = await u.req('POST', '/v1/chat', { message: 'сегодня 80,6' });
    expect(r.status).toBe(200);
    expect(r.body.reply.toolEvents).toEqual([
      expect.objectContaining({ name: 'add_weight_entry', ok: true, outcome: 'created' }),
    ]);
    const list = await u.req('GET', '/v1/weights');
    expect(list.body.items[0]).toMatchObject({
      weightG: kg(80.6),
      source: 'chat',
      measuredOn: today(),
    });
    const [run] = await runs(u.id);
    expect(run).toMatchObject({
      status: 'ok',
      model: 'test-model',
      config_version: 'v1',
      input_tokens: 200,
      output_tokens: 40,
      iterations: 2,
    });
  });

  it('passes tool errors back to the model instead of saving anything', async () => {
    const u = await h.signup();
    h.model.script(
      tools(
        call('add_weight_entry', { weight: 7.84 }),
        call('add_weight_entry', { weight: 'heavy' }),
      ),
      (req) => {
        const outs = toolOutputs(req);
        expect(outs[0]).toMatchObject({ ok: false, error: { code: 'VALIDATION_ERROR' } });
        expect(String((outs[0] as { error: { message: string } }).error.message)).toMatch(
          /outside the allowed range/,
        );
        expect(outs[1]).toMatchObject({
          ok: false,
          error: { code: 'VALIDATION_ERROR', message: 'Invalid arguments' },
        });
        return { text: 'Похоже на опечатку, уточните.' };
      },
    );
    const r = await u.req('POST', '/v1/chat', { message: '7,84' });
    expect(r.body.reply.toolEvents.every((e: { ok: boolean }) => !e.ok)).toBe(true);
    expect((await u.req('GET', '/v1/weights')).body.items).toEqual([]);
  });

  it('does not create a duplicate when the model repeats the same call in one turn', async () => {
    const u = await h.signup();
    h.model.script(
      tools(call('add_weight_entry', { weight: 79 })),
      tools(call('add_weight_entry', { weight: 79 })),
      (req) => {
        expect(toolOutputs(req)[1]).toMatchObject({ ok: true, outcome: 'already_recorded' });
        return { text: 'ok' };
      },
    );
    await u.req('POST', '/v1/chat', { message: '79' });
    expect((await u.req('GET', '/v1/weights')).body.items).toHaveLength(1);
  });

  it('builds context only from the current user: settings, memory, recent messages', async () => {
    const a = await h.signup();
    const b = await h.signup();
    await a.req('POST', '/v1/memory', { content: 'SECRET-OF-A' });
    await b.req('PATCH', '/v1/me', {
      displayName: 'Борис',
      timezone: 'Europe/Moscow',
      preferences: { reportFormat: 'brief' },
    });
    await b.req('POST', '/v1/memory', { content: 'Бегаю по средам' });
    h.model.script(say('a'));
    await a.req('POST', '/v1/chat', { message: 'message of A' });
    h.model.script((req) => {
      expect(req.instructions).toContain('Бегаю по средам');
      expect(req.instructions).toContain('Name: Борис');
      expect(req.instructions).toContain('Europe/Moscow');
      expect(req.instructions).toMatch(/Report format: brief/);
      expect(req.instructions).not.toContain('SECRET-OF-A');
      expect(JSON.stringify(req.input)).not.toContain('message of A');
      expect(req.input.at(-1)).toEqual({ role: 'user', content: 'как дела?' });
      expect(req.tools.map((t) => t.name).sort()).toEqual([...TOOL_NAMES].sort());
      return { text: 'b' };
    });
    expect((await b.req('POST', '/v1/chat', { message: 'как дела?' })).status).toBe(200);
  });

  it('continues a conversation with its earlier messages', async () => {
    const u = await h.signup();
    h.model.script(say('первый ответ'));
    const first = await u.req('POST', '/v1/chat', { message: 'первый' });
    h.model.script((req) => {
      expect(req.input).toEqual([
        { role: 'user', content: 'первый' },
        { role: 'assistant', content: 'первый ответ' },
        { role: 'user', content: 'второй' },
      ]);
      return { text: 'второй ответ' };
    });
    await u.req('POST', '/v1/chat', {
      conversationId: first.body.conversationId,
      message: 'второй',
    });
    const conv = await u.req('GET', `/v1/conversations/${first.body.conversationId}`);
    expect(conv.body.messages.map((m: { content: string }) => m.content)).toEqual([
      'первый',
      'первый ответ',
      'второй',
      'второй ответ',
    ]);
  });
});

describe('agent: deletion needs confirmation in a later message (ADR-009)', () => {
  it('prepares, refuses same-turn confirmation, then deletes after the user confirms', async () => {
    const u = await h.signup();
    const e = await u.req('POST', '/v1/weights', { weightG: kg(82.4) });
    let confirmationId = '';
    h.model.script(
      tools(call('delete_weight_entry', { entry_id: e.body.id })),
      (req) => {
        const out = toolOutputs(req)[0] as { outcome: string; confirmation_id: string };
        expect(out.outcome).toBe('confirmation_required');
        confirmationId = out.confirmation_id;
        return {
          functionCalls: [
            call('delete_weight_entry', { entry_id: e.body.id, confirmation_id: confirmationId }),
          ],
        };
      },
      (req) => {
        expect(toolOutputs(req).at(-1)).toMatchObject({
          ok: false,
          outcome: 'confirmation_invalid',
        });
        return { text: 'Удалить 82,4 кг за сегодня? Подтвердите.' };
      },
    );
    const t1 = await u.req('POST', '/v1/chat', { message: 'удали последнюю запись' });
    expect(t1.body.pendingAction).toMatchObject({
      type: 'delete_weight_entry',
      entryId: e.body.id,
      confirmationId,
    });
    expect((await u.req('GET', `/v1/weights/${e.body.id}`)).status).toBe(200);

    h.model.script(
      (req) => {
        expect(req.instructions).toContain(`confirmation_id=${confirmationId}`);
        return {
          functionCalls: [
            call('delete_weight_entry', { entry_id: e.body.id, confirmation_id: confirmationId }),
          ],
        };
      },
      (req) => {
        expect(toolOutputs(req)[0]).toMatchObject({ ok: true, outcome: 'deleted' });
        return { text: 'Удалил.' };
      },
    );
    const t2 = await u.req('POST', '/v1/chat', {
      conversationId: t1.body.conversationId,
      message: 'да',
    });
    expect(t2.body.pendingAction).toBeNull();
    expect((await u.req('GET', `/v1/weights/${e.body.id}`)).status).toBe(404);
  });

  it('refuses an expired confirmation and a wrong one', async () => {
    const u = await h.signup();
    const e = await u.req('POST', '/v1/weights', { weightG: kg(70) });
    let cid = '';
    h.model.script(tools(call('delete_weight_entry', { entry_id: e.body.id })), (req) => {
      cid = (toolOutputs(req)[0] as { confirmation_id: string }).confirmation_id;
      return { text: 'Подтвердите' };
    });
    const t1 = await u.req('POST', '/v1/chat', { message: 'удали' });
    h.model.script(
      tools(call('delete_weight_entry', { entry_id: e.body.id, confirmation_id: randomUUID() })),
      (req) => {
        expect(toolOutputs(req)[0]).toMatchObject({ ok: false, outcome: 'confirmation_invalid' });
        return { text: 'не вышло' };
      },
    );
    await u.req('POST', '/v1/chat', { conversationId: t1.body.conversationId, message: 'да' });
    h.now.value = new Date(Date.now() + 11 * 60 * 1000);
    h.model.script(
      (req) => {
        expect(req.instructions).not.toContain('Pending action');
        return {
          functionCalls: [
            call('delete_weight_entry', { entry_id: e.body.id, confirmation_id: cid }),
          ],
        };
      },
      (req) => {
        expect(toolOutputs(req)[0]).toMatchObject({ ok: false, outcome: 'confirmation_invalid' });
        return { text: 'истекло' };
      },
    );
    await u.req('POST', '/v1/chat', {
      conversationId: t1.body.conversationId,
      message: 'да, удаляй',
    });
    h.now.value = new Date();
    expect((await u.req('GET', `/v1/weights/${e.body.id}`)).status).toBe(200);
  });

  it("cannot touch another user's entry through tools", async () => {
    const a = await h.signup();
    const b = await h.signup();
    const e = await a.req('POST', '/v1/weights', { weightG: kg(70) });
    h.model.script(
      tools(
        call('update_weight_entry', { entry_id: e.body.id, weight: 50 }),
        call('delete_weight_entry', { entry_id: e.body.id }),
      ),
      (req) => {
        expect(toolOutputs(req).map((o) => (o as { error: { code: string } }).error.code)).toEqual([
          'NOT_FOUND',
          'NOT_FOUND',
        ]);
        return { text: 'нет такой записи' };
      },
    );
    await b.req('POST', '/v1/chat', { message: `измени ${e.body.id}` });
    expect((await a.req('GET', `/v1/weights/${e.body.id}`)).body.weightG).toBe(kg(70));
  });
});

describe('agent: goals, memory and reports', () => {
  it('sets a goal and returns a forecast from the core', async () => {
    const u = await h.signup();
    for (let i = 14; i >= 0; i--)
      await u.req('POST', '/v1/weights', {
        weightG: kg(84) - (14 - i) * 70,
        measuredOn: addDays(today(), -i),
      });
    h.model.script(
      tools(call('manage_goal', { action: 'set', target_weight: 78 })),
      (req) => {
        expect(toolOutputs(req)[0]).toMatchObject({
          ok: true,
          outcome: 'goal_set',
          goal: { direction: 'lose', target: '78.0 kg' },
          forecast: { status: 'ok' },
        });
        return { text: 'Цель поставлена' };
      },
      tools(call('generate_report', { period: 'week' })),
      (req) => {
        expect(toolOutputs(req)[0]).toMatchObject({
          ok: true,
          period: { calendarDays: 7, measuredDays: 7 },
          trend: '−0.5 kg/week',
          reportFormat: 'standard',
        });
        return { text: 'Отчёт' };
      },
    );
    await u.req('POST', '/v1/chat', { message: 'поставь цель 78' });
    expect((await u.req('GET', '/v1/goals/active')).body.goal.targetWeightG).toBe(kg(78));
    await u.req('POST', '/v1/chat', { message: 'отчёт за неделю' });
  });

  it('keeps weights out of memory and respects memory being turned off', async () => {
    const u = await h.signup();
    h.model.script(
      tools(
        call('update_agent_memory', { action: 'add', content: 'Бегаю по средам', kind: 'fact' }),
        call('update_agent_memory', { action: 'add', content: 'Мой вес 80 кг' }),
      ),
      (req) => {
        const [ok, rejected] = toolOutputs(req);
        expect(ok).toMatchObject({ ok: true, outcome: 'added' });
        expect(rejected).toMatchObject({ ok: false, outcome: 'rejected_weight_in_memory' });
        return { text: 'запомнил' };
      },
    );
    await u.req('POST', '/v1/chat', { message: 'запомни...' });
    const items = (await u.req('GET', '/v1/memory')).body.items;
    expect(items).toEqual([
      expect.objectContaining({ content: 'Бегаю по средам', source: 'agent' }),
    ]);
    await u.req('PATCH', '/v1/me', { preferences: { memoryEnabled: false } });
    h.model.script(
      (req) => {
        expect(req.instructions).toContain('memory is turned off');
        expect(req.instructions).not.toContain('Бегаю по средам');
        return { functionCalls: [call('update_agent_memory', { action: 'add', content: 'x' })] };
      },
      (req) => {
        expect(toolOutputs(req)[0]).toMatchObject({ ok: false, outcome: 'memory_disabled' });
        return { text: 'память выключена' };
      },
    );
    await u.req('POST', '/v1/chat', { message: 'запомни x' });
  });
});

describe('agent: limits, failures and retries', () => {
  it('stops after the iteration limit and forces a text answer', async () => {
    const u = await h.signup();
    h.model.fallback = (req) =>
      req.toolChoice === 'none'
        ? { text: 'Сделал что смог' }
        : { functionCalls: [call('get_user_profile')] };
    const r = await u.req('POST', '/v1/chat', { message: 'зациклись' });
    h.model.fallback = null;
    expect(r.body).toMatchObject({ limited: true, reply: { content: 'Сделал что смог' } });
    expect(r.body.reply.toolEvents).toHaveLength(3);
    expect((await runs(u.id))[0]).toMatchObject({ status: 'limited', iterations: 4 });
  });

  it('reports AI failures, logs the run, and a retry with the same clientMessageId runs once more without duplicating', async () => {
    const u = await h.signup();
    const clientMessageId = randomUUID();
    h.model.script(() => {
      throw new OpenAI.RateLimitError(429, { message: 'slow down' }, 'slow down', new Headers());
    });
    const r1 = await u.req('POST', '/v1/chat', { message: 'привет', clientMessageId });
    expect(r1.status).toBe(503);
    expect(r1.body.error).toMatchObject({
      code: 'AI_UNAVAILABLE',
      details: { reason: 'rate_limited' },
    });
    expect((await runs(u.id))[0]).toMatchObject({ status: 'error', error_code: 'rate_limited' });

    h.model.script(say('привет!'));
    const r2 = await u.req('POST', '/v1/chat', { message: 'привет', clientMessageId });
    expect(r2.status).toBe(200);
    const before = h.model.requests.length;
    const r3 = await u.req('POST', '/v1/chat', { message: 'привет', clientMessageId });
    expect(h.model.requests.length).toBe(before); // stored reply, no new model call
    expect(r3.body.reply.id).toBe(r2.body.reply.id);
    const conv = await u.req('GET', `/v1/conversations/${r2.body.conversationId}`);
    expect(conv.body.messages.map((m: { role: string }) => m.role)).toEqual(['user', 'assistant']);
  });

  it('enforces the daily token budget', async () => {
    const u = await h.signup();
    h.model.script(() => ({ text: 'дорого', usage: { inputTokens: 4000, outputTokens: 1500 } }));
    expect((await u.req('POST', '/v1/chat', { message: 'раз' })).status).toBe(200);
    const r = await u.req('POST', '/v1/chat', { message: 'два' });
    expect(r.status).toBe(429);
    expect(r.body.error.code).toBe('AI_BUDGET_EXCEEDED');
  });

  it('answers 503 when the AI is not configured, but the diary works', async () => {
    const off = await harness({}, false);
    const u = await off.signup();
    const r = await u.req('POST', '/v1/chat', { message: 'привет' });
    expect(r.status).toBe(503);
    expect(r.body.error.code).toBe('AI_NOT_CONFIGURED');
    expect((await u.req('POST', '/v1/weights', { weightG: kg(80) })).status).toBe(201);
  });

  it('summarizes long conversations without sending weights as facts', async () => {
    const u = await h.signup();
    let conversationId: string | undefined;
    for (let i = 0; i < 26; i++) {
      h.model.script(say(`ответ ${i}`));
      if (i === 25) h.model.script(say('Сводка: пользователь спрашивал про отчёты.'));
      const r = await u.req('POST', '/v1/chat', { conversationId, message: `сообщение ${i}` });
      conversationId = r.body.conversationId;
    }
    const last = h.model.requests.at(-1)!;
    expect(last.instructions).toMatch(/Do NOT record weights/);
    const { rows } = await withUser(h.pool, u.id, (db) =>
      db.query('select summary, summary_message_count from conversations where id = $1', [
        conversationId,
      ]),
    );
    expect(rows[0]).toMatchObject({
      summary: 'Сводка: пользователь спрашивал про отчёты.',
      summary_message_count: 32,
    });
    h.model.script((req) => {
      expect(req.instructions).toContain('Сводка: пользователь спрашивал про отчёты.');
      expect(req.input.length).toBeLessThanOrEqual(20);
      return { text: 'ok' };
    });
    await u.req('POST', '/v1/chat', { conversationId, message: 'ещё' });
  });
});

describe('agent internals', () => {
  it('maps OpenAI errors without swapping models silently', () => {
    const h0 = new Headers();
    expect(
      mapOpenAIError(new OpenAI.NotFoundError(404, { message: 'model' }, 'model', h0)),
    ).toMatchObject({ code: 'AI_NOT_CONFIGURED', details: { reason: 'model_unavailable' } });
    expect(mapOpenAIError(new OpenAI.AuthenticationError(401, {}, 'bad key', h0))).toMatchObject({
      code: 'AI_NOT_CONFIGURED',
    });
    expect(mapOpenAIError(new OpenAI.APIConnectionTimeoutError())).toMatchObject({
      code: 'AI_UNAVAILABLE',
      details: { reason: 'timeout' },
    });
    expect(mapOpenAIError(new OpenAI.InternalServerError(500, {}, 'boom', h0))).toMatchObject({
      status: 503,
    });
  });

  it('exposes JSON-schema tool definitions without $schema', () => {
    const defs = toolDefinitions(TOOL_NAMES);
    expect(defs).toHaveLength(10);
    const add = defs.find((d) => d.name === 'add_weight_entry')!;
    expect(add.parameters).toMatchObject({
      type: 'object',
      required: ['weight'],
      additionalProperties: false,
    });
    expect(add.parameters).not.toHaveProperty('$schema');
  });

  it('converts local wall time to UTC across DST', () => {
    expect(zonedTimeToUtc('2026-07-01', '07:30', 'Europe/Berlin').toISOString()).toBe(
      '2026-07-01T05:30:00.000Z',
    );
    expect(zonedTimeToUtc('2026-01-15', '07:30', 'Europe/Berlin').toISOString()).toBe(
      '2026-01-15T06:30:00.000Z',
    );
    expect(zonedTimeToUtc('2026-03-10', '00:00', 'Pacific/Kiritimati').toISOString()).toBe(
      '2026-03-09T10:00:00.000Z',
    );
  });
});
