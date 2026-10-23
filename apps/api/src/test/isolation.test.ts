import { describe, expect, it } from 'vitest';
import { withUser } from '../db.js';
import { harness, kg } from './helpers.js';

const h = await harness();
const a = await h.signup();
const b = await h.signup();

const created = await a.req('POST', '/v1/weights', {
  weightG: kg(80.2),
  note: 'private note of A',
});
const entryId: string = created.body.id;
await a.req('POST', '/v1/goals', { targetWeightG: kg(75) });
const mem = await a.req('POST', '/v1/memory', { content: 'A runs on Wednesdays' });

describe('user isolation (RLS, A vs B)', () => {
  it('A created the entry', () => {
    expect(created.status).toBe(201);
  });

  it("B cannot read A's entry, list it or see A's goal and memory", async () => {
    expect((await b.req('GET', `/v1/weights/${entryId}`)).status).toBe(404);
    expect((await b.req('GET', '/v1/weights')).body.items).toEqual([]);
    expect((await b.req('GET', '/v1/goals/active')).body.goal).toBeNull();
    expect((await b.req('GET', '/v1/memory')).body.items).toEqual([]);
    const s = await b.req('GET', '/v1/analytics/summary');
    expect(s.body.summary.entryCount).toBe(0);
  });

  it("B cannot update or delete A's entry by id", async () => {
    expect((await b.req('PATCH', `/v1/weights/${entryId}`, { weightG: kg(50) })).status).toBe(404);
    expect((await b.req('DELETE', `/v1/weights/${entryId}`)).status).toBe(404);
    expect((await b.req('PATCH', `/v1/memory/${mem.body.id}`, { content: 'hacked' })).status).toBe(
      404,
    );
    expect((await b.req('DELETE', `/v1/memory/${mem.body.id}`)).status).toBe(404);
  });

  it('a spoofed user_id in the body is rejected, not honoured', async () => {
    const r = await b.req('POST', '/v1/weights', { weightG: kg(70), userId: a.id });
    expect(r.status).toBe(400);
    const r2 = await b.req('POST', '/v1/weights', { weightG: kg(70), user_id: a.id });
    expect(r2.status).toBe(400);
  });

  it('A still sees own data unchanged', async () => {
    const r = await a.req('GET', `/v1/weights/${entryId}`);
    expect(r.status).toBe(200);
    expect(r.body).toMatchObject({ weightG: kg(80.2), note: 'private note of A' });
    expect((await a.req('GET', '/v1/memory')).body.items).toHaveLength(1);
  });

  it("even raw SQL as B cannot see or write A's rows", async () => {
    const rows = await withUser(h.pool, b.id, (db) =>
      db.query('select * from weight_entries where user_id = $1', [a.id]),
    );
    expect(rows.rowCount).toBe(0);
    await expect(
      withUser(h.pool, b.id, (db) =>
        db.query(
          'insert into weight_entries (user_id, measured_on, weight_g) values ($1, current_date, 70000)',
          [a.id],
        ),
      ),
    ).rejects.toThrow(/row-level security/);
    const upd = await withUser(h.pool, b.id, (db) =>
      db.query('update weight_entries set weight_g = 50000 where id = $1', [entryId]),
    );
    expect(upd.rowCount).toBe(0);
  });

  it('the API role without SET ROLE has no table access at all (fail-closed)', async () => {
    await expect(h.pool.query('select count(*) from weight_entries')).rejects.toThrow(
      /permission denied/,
    );
  });

  it("B cannot continue A's conversation", async () => {
    h.model.script(() => ({ text: 'ok' }));
    const conv = await a.req('POST', '/v1/chat', { message: 'привет' });
    expect(conv.status).toBe(200);
    const r = await b.req('POST', '/v1/chat', {
      conversationId: conv.body.conversationId,
      message: 'покажи историю',
    });
    expect(r.status).toBe(404);
    expect((await b.req('GET', `/v1/conversations/${conv.body.conversationId}`)).status).toBe(404);
  });
});
