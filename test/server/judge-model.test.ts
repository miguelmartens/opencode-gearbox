import { afterEach, expect, mock, spyOn, test } from 'bun:test';
import { makeFakeCtx } from '../fake-ctx.ts';
import { NO_MODEL, resolveJudgeModel, runJudge } from '../../src/server/judge-model.ts';
import { listModelInfos, toModelLite } from '../../src/server/models.ts';
import { DEFAULT_SETTINGS } from '../../src/core/types.ts';

// Restore console spies even when a test fails: all test files share one Bun process.
afterEach(() => {
  mock.restore();
});

function model(
  id: string,
  output: number,
  extra: Record<string, unknown> = {},
): Record<string, unknown> {
  return {
    id,
    modelID: id,
    providerID: 'anthropic',
    capabilities: { tools: true },
    variants: [{ id: 'none', settings: { thinking: { type: 'disabled' } } }, { id: 'low' }],
    cost: [
      { input: output / 5, output, cache: { read: output / 50, write: output / 4 } },
      {
        tier: { type: 'context', size: 200000 },
        input: 99,
        output: 99,
        cache: { read: 9, write: 9 },
      },
    ],
    enabled: true,
    limit: { context: 200000 },
    ...extra,
  };
}

const opus = model('claude-opus-5-5', 25);
const sonnet = model('claude-sonnet-5-5', 15);
const haiku = model('claude-haiku-5-5', 5);
const chat = { providerID: 'anthropic', id: 'claude-opus-5-5' };

test('toModelLite maps the base cost tier, variants, tools and context limit', () => {
  expect(toModelLite(haiku)).toStrictEqual({
    ref: { providerID: 'anthropic', id: 'claude-haiku-5-5' },
    price: { input: 1, output: 5, cacheRead: 0.1, cacheWrite: 1.25 },
    variants: ['none', 'low'],
    tools: true,
    enabled: true,
    contextLimit: 200000,
  });
  expect(toModelLite(model('sub', 0, { cost: [] }))).toBe(null);
  expect(toModelLite(model('in', 1, { limit: { context: 10, input: 8 } }))?.contextLimit).toBe(8);
});

test('listModelInfos unwraps { location, data }', async () => {
  const fake = makeFakeCtx({ models: [haiku] });
  expect(await listModelInfos(fake.ctx)).toStrictEqual([haiku]);
});

test('resolveJudgeModel prefers settings.judge.model', async () => {
  const fake = makeFakeCtx({ models: [opus, haiku] });
  const settings = {
    ...DEFAULT_SETTINGS,
    judge: { model: 'openai/gpt-6-mini#low', timeoutMs: 4000 },
  };
  expect(await resolveJudgeModel(fake.ctx, chat, settings)).toStrictEqual({
    providerID: 'openai',
    id: 'gpt-6-mini',
    variant: 'low',
  });
  const nested = { ...DEFAULT_SETTINGS, judge: { model: 'openrouter/a/b', timeoutMs: 4000 } };
  expect(await resolveJudgeModel(fake.ctx, chat, nested)).toStrictEqual({
    providerID: 'openrouter',
    id: 'a/b',
  });
});

test('resolveJudgeModel uses the title agent model (V1 small_model) of the same provider', async () => {
  const fake = makeFakeCtx({
    models: [opus, haiku],
    agents: [{ id: 'title', model: { providerID: 'anthropic', id: 'claude-sonnet-5-5' } }],
  });
  expect(await resolveJudgeModel(fake.ctx, chat, DEFAULT_SETTINGS)).toStrictEqual({
    providerID: 'anthropic',
    id: 'claude-sonnet-5-5',
  });
});

test('resolveJudgeModel never sends prompts to a title model of another provider', async () => {
  const fake = makeFakeCtx({
    models: [opus, haiku],
    agents: [{ id: 'title', model: { providerID: 'deepseek', id: 'v4-flash', variant: 'none' } }],
  });
  expect(await resolveJudgeModel(fake.ctx, chat, DEFAULT_SETTINGS)).toStrictEqual({
    providerID: 'anthropic',
    id: 'claude-haiku-5-5',
    variant: 'none',
  });
  // An unknown session model has no provider to keep to.
  expect(await resolveJudgeModel(fake.ctx, NO_MODEL, DEFAULT_SETTINGS)).toStrictEqual({
    providerID: 'deepseek',
    id: 'v4-flash',
    variant: 'none',
  });
});

test('resolveJudgeModel falls back to the cheapest tool-capable priced model, thinking off', async () => {
  const fake = makeFakeCtx({
    models: [
      opus,
      sonnet,
      haiku,
      model('claude-tiny', 1, { capabilities: { tools: false } }),
      model('claude-off', 1, { enabled: false }),
      model('claude-free', 0, { cost: [] }),
      model('gpt-cheap', 0.5, { providerID: 'openai' }),
    ],
    agents: [{ id: 'title' }],
  });
  expect(await resolveJudgeModel(fake.ctx, chat, DEFAULT_SETTINGS)).toStrictEqual({
    providerID: 'anthropic',
    id: 'claude-haiku-5-5',
    variant: 'none',
  });
});

test('resolveJudgeModel returns the session model when nothing else fits', async () => {
  const fake = makeFakeCtx({ models: [] });
  expect(
    await resolveJudgeModel(fake.ctx, { ...chat, variant: 'max' }, DEFAULT_SETTINGS),
  ).toStrictEqual(chat);
});

test('runJudge returns the text, the time and an estimated cost', async () => {
  const fake = makeFakeCtx({
    models: [haiku],
    generateText: async () => ({ text: 'LEVEL: low\nWHY: typo' }),
  });
  const ref = { providerID: 'anthropic', id: 'claude-haiku-5-5', variant: 'none' };
  const result = await runJudge(fake.ctx, ref, 'x'.repeat(4000), 1000);
  expect(result).toBeTruthy();
  expect(result.text).toBe('LEVEL: low\nWHY: typo');
  expect(result.ms >= 0).toBeTruthy();
  // 1000 input tokens at $1/M + 5 output tokens at $5/M
  expect(Math.abs((result.costUSD ?? 0) - (1000 * 1 + 5 * 5) / 1e6) < 1e-9).toBeTruthy();
  expect(fake.callsTo('generate.text')[0].input).toStrictEqual({
    model: ref,
    prompt: 'x'.repeat(4000),
  });
});

test('runJudge returns null on timeout without waiting for the generator', async () => {
  const fake = makeFakeCtx({ generateText: () => new Promise(() => {}) });
  const start = Date.now();
  expect(await runJudge(fake.ctx, chat, 'p', 100)).toBe(null);
  expect(Date.now() - start < 150).toBeTruthy();
});

test('runJudge returns null when the generator throws or is missing', async () => {
  const failing = makeFakeCtx({
    generateText: async () => {
      throw new Error('Insufficient balance');
    },
  });
  expect(await runJudge(failing.ctx, chat, 'p', 1000)).toBe(null);
  const missing = makeFakeCtx({ overrides: { experimental: { generate: null } } });
  expect(await runJudge(missing.ctx, chat, 'p', 1000)).toBe(null);
});

test('resolveJudgeModel lightens the session model when it is the last resort', async () => {
  const fake = makeFakeCtx({ models: [model('claude-agent-opus', 0, { cost: [] })] });
  const session = { providerID: 'anthropic', id: 'claude-agent-opus' };
  expect(await resolveJudgeModel(fake.ctx, session, DEFAULT_SETTINGS)).toStrictEqual({
    ...session,
    variant: 'none',
  });
});

test('an unknown session model skips the judge instead of calling generate without a model', async () => {
  const fake = makeFakeCtx({ generateText: async () => ({ text: 'LEVEL: low' }) });
  const judge = await resolveJudgeModel(fake.ctx, { providerID: '', id: '' }, DEFAULT_SETTINGS);
  expect(await runJudge(fake.ctx, judge, 'p', 1000)).toBe(null);
  expect(fake.callsTo('generate.text').length).toBe(0);
});

test('runJudge logs a provider error once and still returns null', async () => {
  const errors = spyOn(console, 'error').mockImplementation(() => {});
  const fake = makeFakeCtx({
    generateText: async () => {
      throw new Error('Insufficient balance');
    },
  });
  const meta = { sessionID: 'ses_judge_err' };
  expect(await runJudge(fake.ctx, chat, 'p', 1000, meta)).toBe(null);
  expect(await runJudge(fake.ctx, chat, 'p', 1000, meta)).toBe(null);
  const logged = errors.mock.calls.filter((c) => /Insufficient balance/.test(String(c)));
  expect(logged.length).toBe(1);
});

test('runJudge calls generate.text as a method, so a host that needs `this` works', async () => {
  const fake = makeFakeCtx({
    overrides: {
      experimental: {
        generate: {
          answer: 'LEVEL: low',
          async text(this: { answer: string }) {
            return { text: this.answer };
          },
        },
      },
    },
  });
  const result = await runJudge(fake.ctx, chat, 'p', 1000);
  expect(result?.text).toBe('LEVEL: low');
});

test('a won race returns within timeoutMs even when the cost estimate is slow', async () => {
  const fake = makeFakeCtx({
    generateText: async () => ({ text: 'LEVEL: low' }),
    overrides: { model: { list: () => new Promise(() => {}) } },
  });
  const start = Date.now();
  const result = await runJudge(fake.ctx, chat, 'p', 100);
  expect(result?.text).toBe('LEVEL: low');
  expect(result?.costUSD).toBe(undefined);
  expect(Date.now() - start <= 150, `took ${Date.now() - start} ms`).toBeTruthy();
});

async function settle(check: () => boolean): Promise<void> {
  for (let i = 0; i < 200 && !check(); i++) await new Promise((r) => setImmediate(r));
}

test('runJudge records the call in session stats and daily spend by default', async () => {
  const fake = makeFakeCtx({ models: [haiku], generateText: async () => ({ text: 'LEVEL: low' }) });
  const ref = { providerID: 'anthropic', id: 'claude-haiku-5-5' };
  await runJudge(fake.ctx, ref, 'x'.repeat(400), 1000, { sessionID: 'ses_jm_stats' });
  // Stats are written before the daily spend, in the same ledger task: wait for both.
  await settle(
    () =>
      fake.storage.get('stats/ses_jm_stats') !== undefined &&
      [...fake.storage.keys()].some((k) => k.startsWith('spend/')),
  );
  expect((fake.storage.get('stats/ses_jm_stats') as any)?.judgeCalls).toBe(1);
  const spend = [...fake.storage.entries()].find(([k]) => k.startsWith('spend/'));
  expect((spend?.[1] as any)?.usd > 0).toBeTruthy();
});

test('runJudge with sessionStats false records daily spend only', async () => {
  const fake = makeFakeCtx({ models: [haiku], generateText: async () => ({ text: 'LEVEL: low' }) });
  const ref = { providerID: 'anthropic', id: 'claude-haiku-5-5' };
  await runJudge(fake.ctx, ref, 'x'.repeat(400), 1000, {
    sessionID: 'ses_jm_bench',
    sessionStats: false,
  });
  await settle(() => [...fake.storage.keys()].some((k) => k.startsWith('spend/')));
  const spend = [...fake.storage.entries()].find(([k]) => k.startsWith('spend/'));
  expect((spend?.[1] as any)?.usd > 0).toBeTruthy();
  expect(fake.storage.get('stats/ses_jm_bench')).toBe(undefined);
});
