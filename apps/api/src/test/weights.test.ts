import { randomUUID } from 'node:crypto';
import { addDays, computeSummary, localDateInTimeZone } from '@weight-ai/core';
import { describe, expect, it } from 'vitest';
import { withUser } from '../db.js';
import { harness, kg } from './helpers.js';

const h = await harness();

describe('weights', () => {
  it('defaults the date to today in the profile time zone', async () => {
    const u = await h.signup();
    await u.req('PATCH', '/v1/me', { timezone: 'Pacific/Kiritimati' }); // UTC+14
    h.now.value = new Date('2026-03-10T20:00:00Z'); // already 11 March there
    const r = await u.req('POST', '/v1/weights', { weightG: kg(81) });
    expect(r.status).toBe(201);
    expect(r.body.measuredOn).toBe('2026-03-11');
    h.now.value = new Date();
  });

  it('rejects future dates, out-of-range weights and unknown fields', async () => {
    const u = await h.signup();
    const tomorrow = addDays(localDateInTimeZone(new Date(), 'UTC'), 1);
    expect(
      (await u.req('POST', '/v1/weights', { weightG: kg(80), measuredOn: tomorrow })).status,
    ).toBe(400);
    expect((await u.req('POST', '/v1/weights', { weightG: 7840 })).status).toBe(400);
    expect((await u.req('POST', '/v1/weights', { weightG: 80000.5 })).status).toBe(400);
    expect(
      (await u.req('POST', '/v1/weights', { weightG: kg(80), measuredOn: '2026-02-30' })).status,
    ).toBe(400);
    const r = await u.req('POST', '/v1/weights', { weightG: kg(80), extra: 1 });
    expect(r.status).toBe(400);
    expect(r.body.error.code).toBe('VALIDATION_ERROR');
  });

  it('flags a same-day same-weight duplicate unless allowed (ADR-004)', async () => {
    const u = await h.signup();
    const first = await u.req('POST', '/v1/weights', { weightG: kg(80), measuredOn: '2026-01-05' });
    const dup = await u.req('POST', '/v1/weights', { weightG: kg(80), measuredOn: '2026-01-05' });
    expect(dup.status).toBe(409);
    expect(dup.body.error).toMatchObject({
      code: 'DUPLICATE_ENTRY',
      details: { existingId: first.body.id },
    });
    expect(
      (
        await u.req('POST', '/v1/weights', {
          weightG: kg(80),
          measuredOn: '2026-01-05',
          allowDuplicate: true,
        })
      ).status,
    ).toBe(201);
  });

  it('is idempotent by clientEntryId (retries and concurrent sends)', async () => {
    const u = await h.signup();
    const clientEntryId = randomUUID();
    const results = await Promise.all(
      [1, 2, 3].map(() =>
        u.req('POST', '/v1/weights', { weightG: kg(79.5), clientEntryId, allowDuplicate: true }),
      ),
    );
    const ids = new Set(results.map((r) => r.body.id));
    expect(ids.size).toBe(1);
    expect(results.filter((r) => r.status === 201)).toHaveLength(1);
    expect((await u.req('GET', '/v1/weights')).body.items).toHaveLength(1);
  });

  it('rejects two entries at the same exact instant', async () => {
    const u = await h.signup();
    const at = '2026-01-10T06:30:00Z';
    expect((await u.req('POST', '/v1/weights', { weightG: kg(80), measuredAt: at })).status).toBe(
      201,
    );
    const r = await u.req('POST', '/v1/weights', { weightG: kg(80.4), measuredAt: at });
    expect(r.status).toBe(409);
    expect(r.body.error.code).toBe('DUPLICATE_ENTRY');
  });

  it('derives the date from measuredAt and rejects a mismatching date', async () => {
    const u = await h.signup();
    await u.req('PATCH', '/v1/me', { timezone: 'Asia/Vladivostok' }); // UTC+10
    const r = await u.req('POST', '/v1/weights', {
      weightG: kg(80),
      measuredAt: '2026-01-10T22:00:00Z',
    });
    expect(r.body.measuredOn).toBe('2026-01-11');
    const bad = await u.req('POST', '/v1/weights', {
      weightG: kg(80),
      measuredAt: '2026-01-12T22:00:00Z',
      measuredOn: '2026-01-12',
    });
    expect(bad.status).toBe(400);
  });

  it('updates and deletes own entries; moving the day drops the old time', async () => {
    const u = await h.signup();
    const c = await u.req('POST', '/v1/weights', {
      weightG: kg(80),
      measuredAt: '2026-01-10T06:00:00Z',
      note: 'x',
    });
    const p = await u.req('PATCH', `/v1/weights/${c.body.id}`, { weightG: kg(79.9), note: null });
    expect(p.body).toMatchObject({
      weightG: kg(79.9),
      note: null,
      measuredAt: '2026-01-10T06:00:00.000Z',
    });
    const moved = await u.req('PATCH', `/v1/weights/${c.body.id}`, { measuredOn: '2026-01-09' });
    expect(moved.body).toMatchObject({ measuredOn: '2026-01-09', measuredAt: null });
    expect((await u.req('PATCH', `/v1/weights/${c.body.id}`, {})).status).toBe(400);
    expect((await u.req('DELETE', `/v1/weights/${c.body.id}`)).status).toBe(204);
    expect((await u.req('DELETE', `/v1/weights/${c.body.id}`)).status).toBe(404);
    expect((await u.req('GET', '/v1/weights/not-a-uuid')).status).toBe(404);
  });

  it('pages through history with a cursor, newest first', async () => {
    const u = await h.signup();
    for (let i = 0; i < 5; i++)
      await u.req('POST', '/v1/weights', {
        weightG: kg(80 + i / 10),
        measuredOn: `2026-01-0${i + 1}`,
      });
    const p1 = await u.req('GET', '/v1/weights?limit=2');
    expect(p1.body.items.map((e: { measuredOn: string }) => e.measuredOn)).toEqual([
      '2026-01-05',
      '2026-01-04',
    ]);
    const p2 = await u.req('GET', `/v1/weights?limit=2&cursor=${p1.body.nextCursor}`);
    expect(p2.body.items.map((e: { measuredOn: string }) => e.measuredOn)).toEqual([
      '2026-01-03',
      '2026-01-02',
    ]);
    const p3 = await u.req('GET', `/v1/weights?limit=2&cursor=${p2.body.nextCursor}`);
    expect(p3.body.items).toHaveLength(1);
    expect(p3.body.nextCursor).toBeNull();
    expect((await u.req('GET', '/v1/weights?cursor=garbage')).status).toBe(400);
    const range = await u.req('GET', '/v1/weights?from=2026-01-02&to=2026-01-03');
    expect(range.body.items).toHaveLength(2);
  });

  it('limits the request body size', async () => {
    const u = await h.signup();
    const r = await u.req('POST', '/v1/weights', { weightG: kg(80), note: 'x'.repeat(20_000) });
    expect(r.status).toBe(413);
  });
});

describe('goals and analytics', () => {
  it('starts a goal from the latest morning weight and keeps goal history', async () => {
    const u = await h.signup();
    expect((await u.req('POST', '/v1/goals', { targetWeightG: kg(75) })).status).toBe(400); // no data yet
    await u.req('POST', '/v1/weights', { weightG: kg(82), measuredAt: '2026-01-10T06:00:00Z' });
    await u.req('POST', '/v1/weights', { weightG: kg(83), measuredAt: '2026-01-10T19:00:00Z' }); // evening, ignored
    const g1 = await u.req('POST', '/v1/goals', { targetWeightG: kg(75), startDate: '2026-01-10' });
    expect(g1.body).toMatchObject({ startWeightG: kg(82), direction: 'lose', status: 'active' });
    const g2 = await u.req('POST', '/v1/goals', { targetWeightG: kg(90), startDate: '2026-01-10' });
    expect(g2.body.direction).toBe('gain');
    expect((await u.req('GET', '/v1/goals/active')).body.goal.id).toBe(g2.body.id);
    expect((await u.req('DELETE', '/v1/goals/active')).status).toBe(204);
    const history = await withUser(h.pool, u.id, (db) =>
      db.query('select status from goals order by created_at'),
    );
    expect(history.rows.map((r) => r.status)).toEqual(['replaced', 'cancelled']);
    expect((await u.req('GET', '/v1/goals/active')).body.goal).toBeNull();
    expect((await u.req('DELETE', '/v1/goals/active')).status).toBe(404);
  });

  it('returns exactly what the core computes', async () => {
    const u = await h.signup();
    const today = localDateInTimeZone(new Date(), 'UTC');
    const entries = [];
    for (let i = 20; i >= 0; i--) {
      if (i % 4 === 1) continue;
      const measuredOn = addDays(today, -i);
      const weightG = kg(85) - (20 - i) * 80;
      entries.push({ measuredOn, weightG });
      await u.req('POST', '/v1/weights', { weightG, measuredOn });
    }
    const goal = { startWeightG: kg(85), targetWeightG: kg(80), startDate: addDays(today, -20) };
    await u.req('POST', '/v1/goals', goal);
    const r = await u.req('GET', '/v1/analytics/summary');
    expect(r.status).toBe(200);
    const expected = computeSummary(entries, goal, today);
    expect(r.body.summary.averages).toEqual(expected.averages);
    expect(r.body.summary.goal).toEqual(expected.goal);
    expect(r.body.summary.forecast).toEqual(expected.forecast);
    const hist = await u.req('GET', `/v1/analytics/history?from=${addDays(today, -6)}`);
    expect(hist.body.points.length).toBeGreaterThan(3);
    expect(hist.body.points[0]).toHaveProperty('avg7G');
    expect(hist.body.goal.targetWeightG).toBe(kg(80));
    expect((await u.req('GET', '/v1/analytics/history?from=2026-02-01&to=2026-01-01')).status).toBe(
      400,
    );
  });
});

describe('profile, memory and account', () => {
  it('validates time zones and updates preferences', async () => {
    const u = await h.signup();
    expect((await u.req('PATCH', '/v1/me', { timezone: 'Mars/Olympus' })).status).toBe(400);
    const r = await u.req('PATCH', '/v1/me', {
      displayName: 'Анна',
      weightUnit: 'lb',
      onboarded: true,
      preferences: { reportFormat: 'brief', memoryEnabled: false },
    });
    expect(r.body).toMatchObject({
      displayName: 'Анна',
      weightUnit: 'lb',
      preferences: { reportFormat: 'brief', memoryEnabled: false },
    });
    expect(r.body.onboardedAt).not.toBeNull();
  });

  it('lets the user view, edit and delete memory', async () => {
    const u = await h.signup();
    const m = await u.req('POST', '/v1/memory', {
      content: 'Взвешиваюсь после пробежки',
      kind: 'rule',
    });
    expect(m.status).toBe(201);
    expect(
      (await u.req('PATCH', `/v1/memory/${m.body.id}`, { content: 'Взвешиваюсь до пробежки' })).body
        .content,
    ).toBe('Взвешиваюсь до пробежки');
    expect((await u.req('DELETE', `/v1/memory/${m.body.id}`)).status).toBe(204);
    expect((await u.req('GET', '/v1/memory')).body.items).toEqual([]);
  });

  it('deletes the account and all its data only with explicit confirmation', async () => {
    const u = await h.signup();
    await u.req('POST', '/v1/weights', { weightG: kg(80) });
    expect((await u.req('DELETE', '/v1/me', {})).status).toBe(400);
    expect((await u.req('DELETE', '/v1/me', { confirm: 'DELETE' })).status).toBe(204);
    expect((await u.req('GET', '/v1/me')).status).toBe(404);
    const left = await h.pool.query('select count(*)::int as n from auth.users where id = $1', [
      u.id,
    ]);
    expect(left.rows[0].n).toBe(0);
  });
});
