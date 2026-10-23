/**
 * TEST ONLY. API server for the web e2e suite: the real app and database with a small
 * deterministic stand-in for the model, so browser tests can exercise the chat end to end.
 */
import type { ModelClient, ModelRequest, ModelResult } from '../agent/model.js';
import { buildApp } from '../app.js';
import { createVerifier } from '../auth.js';
import { loadConfig } from '../config.js';
import { createPool } from '../db.js';

type Out = Record<string, any>;
let n = 0;
const fc = (name: string, args: Record<string, unknown>) => {
  const callId = `e2e_${++n}`;
  return { callId, name, arguments: JSON.stringify(args) };
};
const reply = (text: string): ModelResult => ({
  text,
  functionCalls: [],
  replay: [],
  usage: { inputTokens: 50, outputTokens: 10 },
});
const calls = (...c: ReturnType<typeof fc>[]): ModelResult => ({
  text: '',
  functionCalls: c,
  replay: c.map((x) => ({
    type: 'function_call',
    call_id: x.callId,
    name: x.name,
    arguments: x.arguments,
  })),
  usage: { inputTokens: 50, outputTokens: 10 },
});

const scripted: ModelClient = {
  async respond(req: ModelRequest) {
    if (!req.tools.length) return reply('Сводка диалога.');
    const userIdx = req.input.map((i) => (i as { role?: string }).role).lastIndexOf('user');
    const text = String((req.input[userIdx] as { content: string }).content).toLowerCase();
    const outs = req.input
      .slice(userIdx)
      .filter((i) => (i as { type?: string }).type === 'function_call_output')
      .map((i) => JSON.parse((i as { output: string }).output) as Out);
    const last = outs.at(-1);
    if (!last) {
      const pending = /confirmation_id=([0-9a-f-]{36})/.exec(req.instructions);
      const entry = /Deletion of entry ([0-9a-f-]{36})/.exec(req.instructions);
      if (pending && entry && /^да/.test(text))
        return calls(
          fc('delete_weight_entry', { entry_id: entry[1], confirmation_id: pending[1] }),
        );
      if (pending && /^нет/.test(text)) return reply('Хорошо, ничего не удаляю.');
      if (/удали/.test(text)) return calls(fc('get_weight_history', { limit: 1 }));
      if (/отч[её]т/.test(text)) return calls(fc('generate_report', { period: 'week' }));
      if (/остал|цел/.test(text)) return calls(fc('calculate_weight_analytics', {}));
      const num = /(\d{2,3}(?:[.,]\d)?)/.exec(text);
      if (num) return calls(fc('add_weight_entry', { weight: Number(num[1]!.replace(',', '.')) }));
      return reply('Здравствуйте! Напишите вес, например «сегодня 78,4».');
    }
    if (!last.ok)
      return reply(`Не получилось: ${last.error?.message ?? last.error ?? last.outcome}`);
    switch (last.outcome) {
      case 'created':
        return reply(`Записал ${last.entry.weight} за ${last.entry.date}.`);
      case 'confirmation_required':
        return reply(`Удалить ${last.willDelete}? Подтвердите.`);
      case 'deleted':
        return reply(`Удалил ${last.deleted.weight}.`);
      default:
        if (last.entries)
          return last.entries[0]
            ? calls(fc('delete_weight_entry', { entry_id: last.entries[0].id }))
            : reply('Записей нет.');
        if (last.period)
          return reply(
            `Отчёт: среднее ${last.average ?? '—'}, измерений ${last.period.measuredDays}.`,
          );
        return reply(last.goal ? `До цели ${last.goal.remaining}.` : 'Цель не задана.');
    }
  },
};

const config = loadConfig({ ...process.env, OPENAI_API_KEY: 'e2e', OPENAI_MODEL: 'e2e-scripted' });
if (config.NODE_ENV === 'production') throw new Error('e2e server must not run in production');
const pool = createPool(config.DATABASE_URL);
const { verifier, local } = createVerifier(config, pool);
const app = await buildApp({ config, pool, verifier, localAuth: local, model: scripted });
await app.listen({ port: config.PORT, host: '127.0.0.1' });
