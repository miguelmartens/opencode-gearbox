import { test } from 'node:test';
import assert from 'node:assert/strict';
import { makeFakeCtx } from '../fake-ctx.ts';
import {
  listModelInfos,
  resolveJudgeModel,
  runJudge,
  toModelLite,
} from '../../src/server/judge-model.ts';
import { DEFAULT_SETTINGS } from '../../src/core/types.ts';

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
  assert.deepEqual(toModelLite(haiku), {
    ref: { providerID: 'anthropic', id: 'claude-haiku-5-5' },
    price: { input: 1, output: 5, cacheRead: 0.1, cacheWrite: 1.25 },
    variants: ['none', 'low'],
    tools: true,
    enabled: true,
    contextLimit: 200000,
  });
  assert.equal(toModelLite(model('sub', 0, { cost: [] })), null);
  assert.equal(toModelLite(model('in', 1, { limit: { context: 10, input: 8 } }))?.contextLimit, 8);
});

test('listModelInfos unwraps { location, data }', async () => {
  const fake = makeFakeCtx({ models: [haiku] });
  assert.deepEqual(await listModelInfos(fake.ctx), [haiku]);
});

test('resolveJudgeModel prefers settings.judge.model', async () => {
  const fake = makeFakeCtx({ models: [opus, haiku] });
  const settings = {
    ...DEFAULT_SETTINGS,
    judge: { model: 'openai/gpt-6-mini#low', timeoutMs: 4000 },
  };
  assert.deepEqual(await resolveJudgeModel(fake.ctx, chat, settings), {
    providerID: 'openai',
    id: 'gpt-6-mini',
    variant: 'low',
  });
  const nested = { ...DEFAULT_SETTINGS, judge: { model: 'openrouter/a/b', timeoutMs: 4000 } };
  assert.deepEqual(await resolveJudgeModel(fake.ctx, chat, nested), {
    providerID: 'openrouter',
    id: 'a/b',
  });
});

test('resolveJudgeModel uses the title agent model (V1 small_model)', async () => {
  const fake = makeFakeCtx({
    models: [opus, haiku],
    agents: [{ id: 'title', model: { providerID: 'deepseek', id: 'v4-flash', variant: 'none' } }],
  });
  assert.deepEqual(await resolveJudgeModel(fake.ctx, chat, DEFAULT_SETTINGS), {
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
  assert.deepEqual(await resolveJudgeModel(fake.ctx, chat, DEFAULT_SETTINGS), {
    providerID: 'anthropic',
    id: 'claude-haiku-5-5',
    variant: 'none',
  });
});

test('resolveJudgeModel returns the session model when nothing else fits', async () => {
  const fake = makeFakeCtx({ models: [] });
  assert.deepEqual(
    await resolveJudgeModel(fake.ctx, { ...chat, variant: 'max' }, DEFAULT_SETTINGS),
    chat,
  );
});

test('runJudge returns the text, the time and an estimated cost', async () => {
  const fake = makeFakeCtx({
    models: [haiku],
    generateText: async () => ({ text: 'LEVEL: low\nWHY: typo' }),
  });
  const ref = { providerID: 'anthropic', id: 'claude-haiku-5-5', variant: 'none' };
  const result = await runJudge(fake.ctx, ref, 'x'.repeat(4000), 1000);
  assert.ok(result);
  assert.equal(result.text, 'LEVEL: low\nWHY: typo');
  assert.ok(result.ms >= 0);
  // 1000 input tokens at $1/M + 5 output tokens at $5/M
  assert.ok(Math.abs((result.costUSD ?? 0) - (1000 * 1 + 5 * 5) / 1e6) < 1e-9);
  assert.deepEqual(fake.callsTo('generate.text')[0].input, {
    model: ref,
    prompt: 'x'.repeat(4000),
  });
});

test('runJudge returns null on timeout without waiting for the generator', async () => {
  const fake = makeFakeCtx({ generateText: () => new Promise(() => {}) });
  const start = Date.now();
  assert.equal(await runJudge(fake.ctx, chat, 'p', 100), null);
  assert.ok(Date.now() - start < 150);
});

test('runJudge returns null when the generator throws or is missing', async () => {
  const failing = makeFakeCtx({
    generateText: async () => {
      throw new Error('Insufficient balance');
    },
  });
  assert.equal(await runJudge(failing.ctx, chat, 'p', 1000), null);
  const missing = makeFakeCtx({ overrides: { experimental: { generate: null } } });
  assert.equal(await runJudge(missing.ctx, chat, 'p', 1000), null);
});

test('resolveJudgeModel lightens the session model when it is the last resort', async () => {
  const fake = makeFakeCtx({ models: [model('claude-agent-opus', 0, { cost: [] })] });
  const session = { providerID: 'anthropic', id: 'claude-agent-opus' };
  assert.deepEqual(await resolveJudgeModel(fake.ctx, session, DEFAULT_SETTINGS), {
    ...session,
    variant: 'none',
  });
});

test('an unknown session model skips the judge instead of calling generate without a model', async () => {
  const fake = makeFakeCtx({ generateText: async () => ({ text: 'LEVEL: low' }) });
  const judge = await resolveJudgeModel(fake.ctx, { providerID: '', id: '' }, DEFAULT_SETTINGS);
  assert.equal(await runJudge(fake.ctx, judge, 'p', 1000), null);
  assert.equal(fake.callsTo('generate.text').length, 0);
});

test('runJudge logs a provider error once and still returns null', async (t) => {
  const errors = t.mock.method(console, 'error', () => {});
  const fake = makeFakeCtx({
    generateText: async () => {
      throw new Error('Insufficient balance');
    },
  });
  const meta = { sessionID: 'ses_judge_err' };
  assert.equal(await runJudge(fake.ctx, chat, 'p', 1000, meta), null);
  assert.equal(await runJudge(fake.ctx, chat, 'p', 1000, meta), null);
  const logged = errors.mock.calls.filter((c) => /Insufficient balance/.test(String(c.arguments)));
  assert.equal(logged.length, 1);
});
