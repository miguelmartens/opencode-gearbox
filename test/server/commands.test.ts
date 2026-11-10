import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { makeFakeCtx } from '../fake-ctx.ts';
import type { FakeCtx, FakeCtxOptions } from '../fake-ctx.ts';
import { registerCommands } from '../../src/server/commands.ts';
import type { CommandDeps } from '../../src/server/commands.ts';
import { loadSettings, saveSettings } from '../../src/server/settings-store.ts';
import { getState, resetState } from '../../src/server/state.ts';
import { DEFAULT_SETTINGS, LEVELS } from '../../src/core/types.ts';
import type { Level } from '../../src/core/types.ts';
import { summarize, addTurn, emptyStats } from '../../src/core/stats.ts';
import { buildJudgePrompt } from '../../src/core/judge.ts';

type Case = { id: string; message: string; ok: Level[] };
const cases: Case[] = JSON.parse(
  readFileSync(new URL('../../bench/judge-cases.json', import.meta.url), 'utf8'),
).cases;

const NOW = new Date(2026, 10, 10, 12, 0, 0).getTime();

async function setup(
  opts: FakeCtxOptions = {},
  deps: Partial<CommandDeps> = {},
): Promise<FakeCtx & { lastMessage: () => string }> {
  const fake = makeFakeCtx(opts);
  await registerCommands(fake.ctx, { now: () => NOW, ...deps });
  return { ...fake, lastMessage: () => fake.toasts.at(-1)?.message ?? '' };
}

async function waitFor(check: () => boolean | Promise<boolean>): Promise<void> {
  for (let i = 0; i < 200; i++) {
    if (await check()) return;
    await new Promise((resolve) => setImmediate(resolve));
  }
  throw new Error('condition not met');
}

function stepEnded(sessionID: string, cost: number, input = 100, output = 50) {
  return {
    type: 'session.step.ended',
    data: {
      sessionID,
      finish: 'stop',
      cost,
      tokens: { input, output, reasoning: 0, cache: { read: 10, write: 0 } },
    },
  };
}

test('registers the /gearbox command', async () => {
  const fake = await setup();
  assert.ok(fake.commands.has('gearbox'));
});

test('loadSettings merges plugin options under stored overrides', async () => {
  const fake = makeFakeCtx({
    options: { bias: 1, ceiling: 'high' },
    storage: { settings: { ceiling: 'xhigh' } },
  });
  const s = await loadSettings(fake.ctx);
  assert.equal(s.bias, 1);
  assert.equal(s.ceiling, 'xhigh');
  assert.equal(s.floor, DEFAULT_SETTINGS.floor);
});

test('saveSettings stores only the keys that differ from defaults and options', async () => {
  const fake = makeFakeCtx({ options: { bias: 1 } });
  await saveSettings(fake.ctx, { ...DEFAULT_SETTINGS, bias: 1, swampedAt: 0.5 });
  assert.deepEqual(fake.storage.get('settings'), { swampedAt: 0.5 });
});

test('saveSettings keeps a cleared judge model cleared over plugin options', async () => {
  const fake = makeFakeCtx({ options: { judge: { model: 'p/m' } } });
  const s = await loadSettings(fake.ctx);
  assert.equal(s.judge.model, 'p/m');
  delete s.judge.model;
  await saveSettings(fake.ctx, s);
  assert.equal((await loadSettings(fake.ctx)).judge.model, undefined);
});

test('set bias -1 persists and loadSettings returns it', async () => {
  const fake = await setup();
  await fake.runCommand('gearbox', 'set bias -1');
  assert.equal((await loadSettings(fake.ctx)).bias, -1);
  assert.match(fake.lastMessage(), /bias = -1/);
});

test('set with an invalid value changes nothing and reports the error', async () => {
  const fake = await setup();
  await fake.runCommand('gearbox', 'set bias 9');
  assert.equal(fake.storage.get('settings'), undefined);
  assert.match(fake.lastMessage(), /invalid value for bias/i);
  assert.equal(fake.toasts.at(-1)?.variant, 'error');
});

test('set judge.model null clears the judge model', async () => {
  const fake = await setup({ storage: { settings: { judge: { model: 'p/m' } } } });
  await fake.runCommand('gearbox', 'set judge.model null');
  assert.equal((await loadSettings(fake.ctx)).judge.model, undefined);
});

test('auto off persists auto: false', async () => {
  const fake = await setup();
  await fake.runCommand('gearbox', 'auto off');
  assert.equal((await loadSettings(fake.ctx)).auto, false);
});

test('auto on persists auto: true and clears autoPaused', async () => {
  resetState('ses_auto');
  getState('ses_auto').autoPaused = 'manual variant';
  const fake = await setup({ storage: { settings: { auto: false } } });
  await fake.runCommand('gearbox', 'auto on', 'ses_auto');
  assert.equal((await loadSettings(fake.ctx)).auto, true);
  assert.equal(getState('ses_auto').autoPaused, null);
});

test('save on sets saveMode.until to now + hours, save off clears it', async () => {
  const fake = await setup();
  await fake.runCommand('gearbox', 'save');
  assert.equal((await loadSettings(fake.ctx)).saveMode.until, NOW + 5 * 3_600_000);
  await fake.runCommand('gearbox', 'save off');
  assert.equal((await loadSettings(fake.ctx)).saveMode.until, null);
});

test('settings prints the settings and the modelSwitch.main caveat', async () => {
  const fake = await setup();
  await fake.runCommand('gearbox', 'settings');
  assert.match(fake.lastMessage(), /"bias": 0/);
  assert.match(fake.lastMessage(), /modelSwitch\.main/);
});

test('help lists the subcommands; an unknown subcommand shows help', async () => {
  const fake = await setup();
  await fake.runCommand('gearbox', 'help');
  for (const word of ['auto', 'set', 'settings', 'save', 'stats', 'bench', 'handoff', 'compact'])
    assert.match(fake.lastMessage(), new RegExp(word));
  await fake.runCommand('gearbox', 'frobnicate');
  assert.match(fake.lastMessage(), /unknown subcommand "frobnicate"/);
});

test('stats prints summarize output built from step events', async () => {
  resetState('ses_stats');
  getState('ses_stats').lastDecision = { level: 'high', source: 'followup', reason: 'x' };
  const fake = await setup();
  fake.publish(stepEnded('ses_stats', 0.01));
  fake.publish(stepEnded('ses_stats', 0.02));
  await waitFor(() => (fake.storage.get('stats/ses_stats') as any)?.turns === 2);
  await fake.runCommand('gearbox', 'stats', 'ses_stats');
  const turn = {
    level: 'high' as Level,
    input: 100,
    output: 50,
    cacheRead: 10,
    judgeCostUSD: 0,
    judged: false,
  };
  const expected = addTurn(addTurn(emptyStats(), { ...turn, costUSD: 0.01 }), {
    ...turn,
    costUSD: 0.02,
  });
  assert.equal(fake.lastMessage(), summarize(expected));
  assert.deepEqual(getState('ses_stats').stats, expected);
});

test('stats counts the judge cost of a decision once', async () => {
  resetState('ses_judge');
  getState('ses_judge').lastDecision = {
    level: 'low',
    source: 'judge',
    reason: 'x',
    judgeCostUSD: 0.001,
  };
  const fake = await setup();
  fake.publish(stepEnded('ses_judge', 0));
  fake.publish(stepEnded('ses_judge', 0));
  await waitFor(() => (fake.storage.get('stats/ses_judge') as any)?.turns === 2);
  const stats = fake.storage.get('stats/ses_judge') as any;
  assert.equal(stats.judgeCalls, 1);
  assert.equal(stats.judgeCostUSD, 0.001);
});

test('a zero-cost step is priced from tokens and the model price', async () => {
  resetState('ses_price');
  const model = {
    id: 'm',
    providerID: 'p',
    cost: [{ input: 1, output: 10, cache: { read: 0.1, write: 2 } }],
  };
  const fake = await setup({ models: [model] });
  fake.publish({
    type: 'session.step.started',
    data: { sessionID: 'ses_price', model: { providerID: 'p', id: 'm', variant: 'low' } },
  });
  fake.publish(stepEnded('ses_price', 0, 1_000_000, 100_000));
  await waitFor(() => (fake.storage.get('stats/ses_price') as any)?.turns === 1);
  const stats = fake.storage.get('stats/ses_price') as any;
  // 1M input × $1 + 100k output × $10 + 10 cache-read tokens × $0.1 per 1M.
  assert.ok(Math.abs(stats.costUSD - (1 + 1 + 0.000001)) < 1e-9);
});

test('budget warn shows one toast and turns save mode on', async () => {
  resetState('ses_budget');
  const fake = await setup({ storage: { settings: { budget: { dailyUSD: 10 } } } });
  fake.publish(stepEnded('ses_budget', 8.5));
  await waitFor(async () => (await loadSettings(fake.ctx)).saveMode.until !== null);
  assert.equal((await loadSettings(fake.ctx)).saveMode.until, NOW + 5 * 3_600_000);
  fake.publish(stepEnded('ses_budget', 0.1));
  await waitFor(() => (fake.storage.get('stats/ses_budget') as any)?.turns === 2);
  const warns = fake.toasts.filter((t) => /budget/i.test(t.message));
  assert.equal(warns.length, 1);
  assert.equal(warns[0].variant, 'warning');
});

test('budget over shows a toast every user turn', async () => {
  resetState('ses_over');
  const fake = await setup({
    storage: { settings: { budget: { dailyUSD: 1 } } },
  });
  getState('ses_over').userTurn = 1;
  fake.publish(stepEnded('ses_over', 2));
  fake.publish(stepEnded('ses_over', 0.1));
  await waitFor(() => (fake.storage.get('stats/ses_over') as any)?.turns === 2);
  getState('ses_over').userTurn = 2;
  fake.publish(stepEnded('ses_over', 0.1));
  await waitFor(() => (fake.storage.get('stats/ses_over') as any)?.turns === 3);
  const overs = fake.toasts.filter((t) => /over the daily budget/i.test(t.message));
  assert.equal(overs.length, 2);
  assert.equal(overs[0].variant, 'error');
});

test('bench with a fake judge correct on 70 of 75 cases prints 70/75 (93%) and the misses', async () => {
  assert.equal(cases.length, 75);
  // A few cases share a judge prompt (they differ only in `current`, which the judge never
  // sees): answer them with a level every one of them accepts, and miss only unique prompts.
  const byPrompt = new Map<string, Case[]>();
  for (const c of cases) {
    const prompt = buildJudgePrompt({
      prompt: c.message,
      lastReplyTail: c.context ?? '',
      contextRatio: null,
      isSubagent: false,
    });
    byPrompt.set(prompt, [...(byPrompt.get(prompt) ?? []), c]);
  }
  const missed = new Set(
    [...byPrompt.values()]
      .filter((group) => group.length === 1)
      .slice(0, 5)
      .map(([c]) => c.id),
  );
  const judged: string[] = [];
  const fake = await setup(
    {},
    {
      runJudge: async (_ctx, model, prompt) => {
        judged.push(`${model.providerID}/${model.id}`);
        const group = byPrompt.get(prompt);
        assert.ok(group, `unknown bench prompt: ${prompt}`);
        const level = missed.has(group[0].id)
          ? LEVELS.find((l) => !group[0].ok.includes(l))
          : LEVELS.find((l) => group.every((c) => c.ok.includes(l)));
        return { text: `LEVEL: ${level}\nWHY: test`, ms: 1 };
      },
    },
  );
  await fake.runCommand('gearbox', 'bench opencode-go/claude-haiku-5-5');
  const out = fake.lastMessage();
  assert.match(out, /70\/75 \(93%\)/);
  for (const id of missed) assert.match(out, new RegExp(`\\b${id}\\b`));
  assert.equal(judged.length, 75);
  assert.ok(judged.every((m) => m === 'opencode-go/claude-haiku-5-5'));
});

test('bench without a model uses the resolved judge model', async () => {
  const fake = await setup(
    { sessions: { ses_b: { id: 'ses_b', model: { providerID: 'p', id: 'big' } } } },
    {
      resolveJudgeModel: async () => ({ providerID: 'p', id: 'small' }),
      runJudge: async () => null,
    },
  );
  await fake.runCommand('gearbox', 'bench', 'ses_b');
  assert.match(fake.lastMessage(), /p\/small/);
  assert.match(fake.lastMessage(), /0\/75 \(0%\)/);
});

test('handoff full calls handoff with mode full and reports the new session', async () => {
  const seen: unknown[] = [];
  const fake = await setup(
    {},
    {
      handoff: async (_ctx, sessionID, mode) => {
        seen.push([sessionID, mode]);
        return { newSessionID: 'ses_new', file: 'HANDOFF.md' };
      },
    },
  );
  await fake.runCommand('gearbox', 'handoff full', 'ses_h');
  assert.deepEqual(seen, [['ses_h', 'full']]);
  assert.match(fake.lastMessage(), /ses_new/);
  assert.match(fake.lastMessage(), /HANDOFF\.md/);
});

test('compact passes the note to compactNow', async () => {
  const seen: unknown[] = [];
  const fake = await setup(
    {},
    {
      compactNow: async (_ctx, sessionID, note) => {
        seen.push([sessionID, note]);
      },
    },
  );
  await fake.runCommand('gearbox', 'compact keep the parser notes', 'ses_c');
  assert.deepEqual(seen, [['ses_c', 'keep the parser notes']]);
});

test('debug shows the last decision and the request model', async () => {
  resetState('ses_dbg');
  getState('ses_dbg').lastDecision = { level: 'xhigh', source: 'judge', reason: 'hard bug' };
  const fake = await setup();
  fake.publish({
    type: 'session.step.started',
    data: { sessionID: 'ses_dbg', model: { providerID: 'p', id: 'm', variant: 'xhigh' } },
  });
  fake.publish(stepEnded('ses_dbg', 0));
  await waitFor(() => (fake.storage.get('stats/ses_dbg') as any)?.turns === 1);
  await fake.runCommand('gearbox', 'debug', 'ses_dbg');
  assert.match(fake.lastMessage(), /xhigh/);
  assert.match(fake.lastMessage(), /hard bug/);
  assert.match(fake.lastMessage(), /p\/m#xhigh/);
});

test('status with no arguments shows level and auto state', async () => {
  resetState('ses_st');
  getState('ses_st').lastLevel = 'medium';
  const fake = await setup();
  await fake.runCommand('gearbox', '', 'ses_st');
  assert.match(fake.lastMessage(), /medium/i);
  assert.match(fake.lastMessage(), /Auto/);
});

test('a failing command reports an error and does not throw', async () => {
  const fake = await setup(
    {},
    {
      compactNow: async () => {
        throw new Error('boom');
      },
    },
  );
  await fake.runCommand('gearbox', 'compact', 'ses_err');
  assert.match(fake.lastMessage(), /boom/);
  assert.equal(fake.toasts.at(-1)?.variant, 'error');
});
