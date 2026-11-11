import { expect, test } from 'bun:test';
import { makeFakeCtx } from '../fake-ctx.ts';
import { registerRouting } from '../../src/server/routing.ts';
import { registerCommands } from '../../src/server/commands.ts';
import { runJudge } from '../../src/server/judge-model.ts';
import { recordJudgeCall, recordStep } from '../../src/server/ledger.ts';
import { DEFAULT_SETTINGS, LEVELS } from '../../src/core/types.ts';

const NOW = new Date(2026, 10, 10, 12, 0, 0).getTime();

function model(id: string, output: number) {
  return {
    id,
    providerID: 'anthropic',
    capabilities: { tools: true },
    variants: LEVELS.map((level) => ({ id: level, settings: { effort: level } })),
    cost: [{ input: output / 5, output, cache: { read: output / 50, write: output / 4 } }],
    enabled: true,
    limit: { context: 200000 },
  };
}

const MODELS = [model('claude-opus-5-5', 25), model('claude-haiku-5-5', 5)];
const OPUS = { providerID: 'anthropic', id: 'claude-opus-5-5' };

async function waitFor(check: () => boolean): Promise<void> {
  for (let i = 0; i < 300; i++) {
    if (check()) return;
    await new Promise((resolve) => setTimeout(resolve, 2));
  }
  throw new Error('condition not met');
}

function contextEvent(sessionID: string) {
  return { sessionID, agent: 'build', model: OPUS, messages: [], options: {} as any };
}

function stepEnded(sessionID: string) {
  return {
    type: 'session.step.ended',
    data: {
      sessionID,
      finish: 'stop',
      cost: 0,
      tokens: { input: 100, output: 10, reasoning: 0, cache: { read: 0, write: 0 } },
    },
  };
}

test('one judge call over three context steps counts once, in stats and daily spend', async () => {
  const sessionID = 'ses_ledger_steps';
  const fake = makeFakeCtx({
    models: MODELS,
    agents: [{ id: 'build' }],
    sessions: { [sessionID]: { id: sessionID, model: OPUS } },
    generateText: async () => ({ text: 'LEVEL: high\nWHY: refactor' }),
  });
  await registerRouting(fake.ctx, { loadSettings: async () => structuredClone(DEFAULT_SETTINGS) });
  await registerCommands(fake.ctx, { now: () => NOW });
  await fake.fire('prompt', { sessionID, prompt: { text: 'Refactor the auth module' } });
  for (let i = 0; i < 3; i++) {
    await fake.fire('context', contextEvent(sessionID));
    fake.publish(stepEnded(sessionID));
  }
  await waitFor(() => (fake.storage.get(`stats/${sessionID}`) as any)?.requests === 3);
  const stats = fake.storage.get(`stats/${sessionID}`) as any;
  expect(stats.turns, 'one user turn').toBe(1);
  expect(stats.judgeCalls).toBe(1);
  expect(stats.judgeCostUSD > 0).toBeTruthy();
  const spend = [...fake.storage.entries()].find(([key]) => key.startsWith('spend/'));
  expect(spend, 'daily spend recorded').toBeTruthy();
  const total = [...fake.storage.entries()]
    .filter(([key]) => key.startsWith('spend/'))
    .reduce((sum, [, value]) => sum + (value as any).usd, 0);
  expect(
    Math.abs(total - stats.judgeCostUSD) < 1e-12,
    'spend = judge cost (steps cost 0)',
  ).toBeTruthy();
});

test("a timed-out judge's cost is still recorded once when it finishes", async () => {
  let open!: () => void;
  const gate = new Promise<void>((resolve) => (open = resolve));
  const fake = makeFakeCtx({
    models: MODELS,
    generateText: async () => {
      await gate;
      return { text: 'LEVEL: low' };
    },
  });
  const ref = { providerID: 'anthropic', id: 'claude-haiku-5-5' };
  const sessionID = 'ses_ledger_late';
  expect(await runJudge(fake.ctx, ref, 'x'.repeat(400), 20, { sessionID })).toBe(null);
  expect(fake.storage.get(`stats/${sessionID}`)).toBe(undefined);
  open();
  await waitFor(() => (fake.storage.get(`stats/${sessionID}`) as any)?.judgeCalls === 1);
  await new Promise((resolve) => setTimeout(resolve, 20));
  const stats = fake.storage.get(`stats/${sessionID}`) as any;
  expect(stats.judgeCalls).toBe(1);
  expect(stats.turns).toBe(0);
  // 100 input tokens at $1/M + 3 output tokens at $5/M.
  expect(Math.abs(stats.judgeCostUSD - (100 * 1 + 3 * 5) / 1e6) < 1e-12).toBeTruthy();
});

test('a garbage judge answer is still counted with its cost', async () => {
  const fake = makeFakeCtx({ models: MODELS, generateText: async () => ({ text: 'banana' }) });
  const ref = { providerID: 'anthropic', id: 'claude-haiku-5-5' };
  const sessionID = 'ses_ledger_garbage';
  await runJudge(fake.ctx, ref, 'x'.repeat(40), 1000, { sessionID });
  await waitFor(() => (fake.storage.get(`stats/${sessionID}`) as any)?.judgeCalls === 1);
  expect((fake.storage.get(`stats/${sessionID}`) as any).judgeCostUSD > 0).toBeTruthy();
});

test('a deleted session’s stored stats are removed', async () => {
  const fake = makeFakeCtx({
    models: MODELS,
    storage: { 'stats/ses_gone': { turns: 1 }, 'stats/ses_kept': { turns: 2 } },
  });
  await registerCommands(fake.ctx);
  fake.publish({ type: 'session.deleted', data: { sessionID: 'ses_gone' } });
  await waitFor(() => !fake.storage.has('stats/ses_gone'));
  expect(fake.storage.has('stats/ses_kept')).toBe(true);
});

test('daily spend older than 30 days is pruned when spend is recorded', async () => {
  const fake = makeFakeCtx({
    models: MODELS,
    storage: {
      'spend/2026-09-01': { usd: 1, warned: false },
      'spend/2026-10-20': { usd: 2, warned: false },
    },
  });
  await recordJudgeCall(fake.ctx, 'ses_prune', 0.01, NOW);
  expect(fake.storage.has('spend/2026-09-01')).toBe(false);
  expect(fake.storage.has('spend/2026-10-20')).toBe(true);
  expect((fake.storage.get('spend/2026-11-10') as any).usd).toBe(0.01);
});

test('a step and a judge call finishing together are both counted (writes run one at a time)', async () => {
  const fake = makeFakeCtx({ models: MODELS });
  // Slow reads widen the read-then-write window, so unserialized writes would lose an update.
  const read = fake.ctx.storage.get;
  fake.ctx.storage.get = async (key: string) => {
    await new Promise((resolve) => setTimeout(resolve, 5));
    return read(key);
  };
  const step = { level: 'high' as const, input: 1, output: 1, cacheRead: 0, costUSD: 0.5, turn: 1 };
  await Promise.all([
    recordStep(fake.ctx, 'ses_race', step, NOW),
    recordJudgeCall(fake.ctx, 'ses_race', 0.25, NOW),
  ]);
  const stats = fake.storage.get('stats/ses_race') as any;
  expect(stats.costUSD).toBe(0.5);
  expect(stats.judgeCalls).toBe(1);
  expect((fake.storage.get('spend/2026-11-10') as any).usd).toBe(0.75);
});

test('a judge call settling after its session is deleted does not write its stats again', async () => {
  const fake = makeFakeCtx({ models: MODELS, storage: { 'stats/ses_late': { turns: 1 } } });
  await registerCommands(fake.ctx);
  fake.publish({ type: 'session.deleted', data: { sessionID: 'ses_late' } });
  await waitFor(() => !fake.storage.has('stats/ses_late'));
  await recordJudgeCall(fake.ctx, 'ses_late', 0.01, NOW);
  expect(fake.storage.has('stats/ses_late')).toBe(false);
  expect((fake.storage.get('spend/2026-11-10') as any).usd, 'still real spend').toBe(0.01);
});

test('a failing spend prune never fails the request record', async () => {
  const fake = makeFakeCtx({ models: MODELS });
  fake.ctx.storage.scan = async () => {
    throw new Error('scan down');
  };
  const step = { level: 'low' as const, input: 1, output: 1, cacheRead: 0, costUSD: 0.1, turn: 1 };
  await recordStep(fake.ctx, 'ses_prune_fail', step, NOW);
  expect((fake.storage.get('stats/ses_prune_fail') as any).costUSD).toBe(0.1);
  expect((fake.storage.get('spend/2026-11-10') as any).usd).toBe(0.1);
});
