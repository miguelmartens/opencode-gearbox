import { expect, test } from 'bun:test';
import { makeFakeCtx } from '../fake-ctx.ts';
import type { FakeCtx, FakeCtxOptions } from '../fake-ctx.ts';
import { registerCommands } from '../../src/server/commands.ts';
import type { CommandDeps } from '../../src/server/commands.ts';
import { loadSettings, saveSettings } from '../../src/server/settings-store.ts';
import { getState, resetState } from '../../src/server/state.ts';
import { DEFAULT_SETTINGS, LEVELS } from '../../src/core/types.ts';
import type { Level } from '../../src/core/types.ts';
import { summarize, addRequest, emptySessionStats } from '../../src/core/stats.ts';
import { buildJudgePrompt } from '../../src/core/judge.ts';

type Case = { id: string; message: string; ok: Level[] };
const cases: Case[] = (await Bun.file(`${import.meta.dir}/../../bench/judge-cases.json`).json())
  .cases;

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
  expect(fake.commands.has('gearbox')).toBeTruthy();
});

test('loadSettings merges plugin options under stored overrides', async () => {
  const fake = makeFakeCtx({
    options: { bias: 1, ceiling: 'high' },
    storage: { settings: { ceiling: 'xhigh' } },
  });
  const s = await loadSettings(fake.ctx);
  expect(s.bias).toBe(1);
  expect(s.ceiling).toBe('xhigh');
  expect(s.floor).toBe(DEFAULT_SETTINGS.floor);
});

test('saveSettings stores only the keys that differ from defaults and options', async () => {
  const fake = makeFakeCtx({ options: { bias: 1 } });
  await saveSettings(fake.ctx, { ...DEFAULT_SETTINGS, bias: 1, swampedAt: 0.5 });
  expect(fake.storage.get('settings')).toStrictEqual({ swampedAt: 0.5 });
});

test('saveSettings keeps a cleared judge model cleared over plugin options', async () => {
  const fake = makeFakeCtx({ options: { judge: { model: 'p/m' } } });
  const s = await loadSettings(fake.ctx);
  expect(s.judge.model).toBe('p/m');
  delete s.judge.model;
  await saveSettings(fake.ctx, s);
  expect((await loadSettings(fake.ctx)).judge.model).toBe(undefined);
});

test('set bias -1 persists and loadSettings returns it', async () => {
  const fake = await setup();
  await fake.runCommand('gearbox', 'set bias -1');
  expect((await loadSettings(fake.ctx)).bias).toBe(-1);
  expect(fake.lastMessage()).toMatch(/bias = -1/);
});

test('set with an invalid value changes nothing and reports the error', async () => {
  const fake = await setup();
  await fake.runCommand('gearbox', 'set bias 9');
  expect(fake.storage.get('settings')).toBe(undefined);
  expect(fake.lastMessage()).toMatch(/invalid value for bias/i);
  expect(fake.toasts.at(-1)?.variant).toBe('error');
});

test('set judge.model null clears the judge model', async () => {
  const fake = await setup({ storage: { settings: { judge: { model: 'p/m' } } } });
  await fake.runCommand('gearbox', 'set judge.model null');
  expect((await loadSettings(fake.ctx)).judge.model).toBe(undefined);
});

test('auto off persists auto: false', async () => {
  const fake = await setup();
  await fake.runCommand('gearbox', 'auto off');
  expect((await loadSettings(fake.ctx)).auto).toBe(false);
});

test('auto on persists auto: true and clears autoPaused', async () => {
  resetState('ses_auto');
  getState('ses_auto').autoPaused = 'manual variant';
  const fake = await setup({ storage: { settings: { auto: false } } });
  await fake.runCommand('gearbox', 'auto on', 'ses_auto');
  expect((await loadSettings(fake.ctx)).auto).toBe(true);
  expect(getState('ses_auto').autoPaused).toBe(null);
});

test('save on sets saveMode.until to now + hours, save off clears it', async () => {
  const fake = await setup();
  await fake.runCommand('gearbox', 'save');
  expect((await loadSettings(fake.ctx)).saveMode.until).toBe(NOW + 5 * 3_600_000);
  await fake.runCommand('gearbox', 'save off');
  expect((await loadSettings(fake.ctx)).saveMode.until).toBe(null);
});

test('settings prints the settings and the modelSwitch.main caveat', async () => {
  const fake = await setup();
  await fake.runCommand('gearbox', 'settings');
  expect(fake.lastMessage()).toMatch(/"bias": 0/);
  expect(fake.lastMessage()).toMatch(/modelSwitch\.main/);
});

test('help lists the subcommands; an unknown subcommand shows help', async () => {
  const fake = await setup();
  await fake.runCommand('gearbox', 'help');
  for (const word of ['auto', 'set', 'settings', 'save', 'stats', 'bench', 'handoff', 'compact'])
    expect(fake.lastMessage()).toMatch(new RegExp(word));
  await fake.runCommand('gearbox', 'frobnicate');
  expect(fake.lastMessage()).toMatch(/unknown subcommand "frobnicate"/);
});

test('stats prints summarize output built from step events', async () => {
  resetState('ses_stats');
  getState('ses_stats').requestLevel = 'high';
  getState('ses_stats').requestTurn = 1;
  const fake = await setup();
  fake.publish(stepEnded('ses_stats', 0.01));
  fake.publish(stepEnded('ses_stats', 0.02));
  await waitFor(() => (fake.storage.get('stats/ses_stats') as any)?.requests === 2);
  await fake.runCommand('gearbox', 'stats', 'ses_stats');
  const request = { level: 'high' as Level, input: 100, output: 50, cacheRead: 10, turn: 1 };
  const expected = addRequest(addRequest(emptySessionStats(), { ...request, costUSD: 0.01 }), {
    ...request,
    costUSD: 0.02,
  });
  expect(fake.lastMessage()).toBe(summarize(expected));
  expect(fake.lastMessage()).toMatch(/1 turn, 2 requests/);
});

test('stats counts one turn per user prompt and its level once', async () => {
  resetState('ses_turns');
  const state = getState('ses_turns');
  const fake = await setup();
  state.requestTurn = 1;
  state.requestLevel = 'low';
  fake.publish(stepEnded('ses_turns', 0));
  fake.publish(stepEnded('ses_turns', 0));
  await waitFor(() => (fake.storage.get('stats/ses_turns') as any)?.requests === 2);
  state.requestTurn = 2;
  state.requestLevel = 'xhigh';
  fake.publish(stepEnded('ses_turns', 0));
  await waitFor(() => (fake.storage.get('stats/ses_turns') as any)?.requests === 3);
  const stats = fake.storage.get('stats/ses_turns') as any;
  expect(stats.turns).toBe(2);
  expect(stats.byLevel).toStrictEqual({ low: 1, medium: 0, high: 0, xhigh: 1, max: 0 });
});

test('a turn Gearbox did not route counts as manual, not under its last level', async () => {
  resetState('ses_manual');
  const state = getState('ses_manual');
  const fake = await setup();
  // Auto was off or paused: routing left the request alone, so it set no level.
  state.lastDecision = { level: 'low', source: 'judge', reason: 'stale' };
  state.requestTurn = 1;
  state.requestLevel = null;
  fake.publish(stepEnded('ses_manual', 0));
  await waitFor(() => (fake.storage.get('stats/ses_manual') as any)?.requests === 1);
  const stats = fake.storage.get('stats/ses_manual') as any;
  expect(stats.manual).toBe(1);
  expect(stats.byLevel).toStrictEqual({ low: 0, medium: 0, high: 0, xhigh: 0, max: 0 });
});

test('steps never count judge cost: judge calls are recorded when they settle', async () => {
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
  await waitFor(() => (fake.storage.get('stats/ses_judge') as any)?.requests === 2);
  const stats = fake.storage.get('stats/ses_judge') as any;
  expect(stats.judgeCalls).toBe(0);
  expect(stats.judgeCostUSD).toBe(0);
});

test('a step without a cost is priced from tokens and the model price', async () => {
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
  const step = stepEnded('ses_price', 0, 1_000_000, 100_000) as any;
  delete step.data.cost;
  fake.publish(step);
  await waitFor(() => (fake.storage.get('stats/ses_price') as any)?.requests === 1);
  const stats = fake.storage.get('stats/ses_price') as any;
  // 1M input × $1 + 100k output × $10 + 10 cache-read tokens × $0.1 per 1M.
  expect(Math.abs(stats.costUSD - (1 + 1 + 0.000001)) < 1e-9).toBeTruthy();
});

test('a reported zero cost (subscription) is trusted, not priced', async () => {
  resetState('ses_sub');
  const model = { id: 'm', providerID: 'p', cost: [{ input: 1, output: 10 }] };
  const fake = await setup({ models: [model], storage: { settings: { budget: { dailyUSD: 1 } } } });
  fake.publish({
    type: 'session.step.started',
    data: { sessionID: 'ses_sub', model: { providerID: 'p', id: 'm' } },
  });
  fake.publish(stepEnded('ses_sub', 0, 1_000_000, 100_000));
  await waitFor(() => (fake.storage.get('stats/ses_sub') as any)?.requests === 1);
  expect((fake.storage.get('stats/ses_sub') as any).costUSD).toBe(0);
  expect(fake.toasts.filter((t) => /budget/i.test(t.message)).length).toBe(0);
});

test('stored stats with the wrong shape fall back to empty stats', async () => {
  resetState('ses_bad');
  const fake = await setup({ storage: { 'stats/ses_bad': { turns: 'many' } } });
  await fake.runCommand('gearbox', 'stats', 'ses_bad');
  expect(fake.lastMessage()).toBe(summarize(emptySessionStats()));
  fake.publish(stepEnded('ses_bad', 0.01));
  await waitFor(() => (fake.storage.get('stats/ses_bad') as any)?.requests === 1);
});

test('budget warn shows one toast and turns save mode on', async () => {
  resetState('ses_budget');
  const fake = await setup({ storage: { settings: { budget: { dailyUSD: 10 } } } });
  fake.publish(stepEnded('ses_budget', 8.5));
  await waitFor(async () => (await loadSettings(fake.ctx)).saveMode.until !== null);
  expect((await loadSettings(fake.ctx)).saveMode.until).toBe(NOW + 5 * 3_600_000);
  fake.publish(stepEnded('ses_budget', 0.1));
  await waitFor(() => (fake.storage.get('stats/ses_budget') as any)?.requests === 2);
  const warns = fake.toasts.filter((t) => /budget/i.test(t.message));
  expect(warns.length).toBe(1);
  expect(warns[0].variant).toBe('warning');
});

test('budget over shows a toast every user turn', async () => {
  resetState('ses_over');
  const fake = await setup({
    storage: { settings: { budget: { dailyUSD: 1 } } },
  });
  getState('ses_over').userTurn = 1;
  fake.publish(stepEnded('ses_over', 2));
  fake.publish(stepEnded('ses_over', 0.1));
  await waitFor(() => (fake.storage.get('stats/ses_over') as any)?.requests === 2);
  getState('ses_over').userTurn = 2;
  fake.publish(stepEnded('ses_over', 0.1));
  await waitFor(() => (fake.storage.get('stats/ses_over') as any)?.requests === 3);
  const overs = fake.toasts.filter((t) => /over the daily budget/i.test(t.message));
  expect(overs.length).toBe(2);
  expect(overs[0].variant).toBe('error');
});

test('bench with a fake judge correct on 70 of 75 cases prints 70/75 (93%) and the misses', async () => {
  expect(cases.length).toBe(75);
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
        expect(group, `unknown bench prompt: ${prompt}`).toBeTruthy();
        const level = missed.has(group[0].id)
          ? LEVELS.find((l) => !group[0].ok.includes(l))
          : LEVELS.find((l) => group.every((c) => c.ok.includes(l)));
        return { text: `LEVEL: ${level}\nWHY: test`, ms: 1, costUSD: 0.0001 };
      },
    },
  );
  await fake.runCommand('gearbox', 'bench opencode-go/claude-haiku-5-5');
  const out = fake.lastMessage();
  expect(out).toMatch(/answered: 75\/75/);
  expect(out).toMatch(/70\/75 \(93%\)/);
  expect(out).toMatch(/Misses \(5\)/);
  expect(out).not.toMatch(/No answer/);
  expect(out).toMatch(/bench spend: \$0\.0075 over 75 judge calls/);
  for (const id of missed) expect(out).toMatch(new RegExp(`\\b${id}\\b`));
  expect(judged.length).toBe(75);
  expect(judged.every((m) => m === 'opencode-go/claude-haiku-5-5')).toBeTruthy();
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
  expect(fake.lastMessage()).toMatch(/p\/small/);
  expect(fake.lastMessage()).toMatch(/0\/75 \(0%\)/);
});

test('bench retries a failed case once and lists unanswered cases apart from misses', async () => {
  const groups = new Map<string, Case[]>();
  for (const c of cases) {
    const prompt = buildJudgePrompt({
      prompt: c.message,
      lastReplyTail: c.context ?? '',
      contextRatio: null,
      isSubagent: false,
    });
    groups.set(prompt, [...(groups.get(prompt) ?? []), c]);
  }
  const unique = [...groups.entries()].filter(([, group]) => group.length === 1);
  const failing = new Set(unique.slice(0, 3).map(([prompt]) => prompt));
  const flaky = unique[3][0];
  const calls = new Map<string, number>();
  const metas: unknown[] = [];
  const fake = await setup(
    {},
    {
      runJudge: async (_ctx, _model, prompt, _timeout, meta) => {
        metas.push(meta);
        const n = (calls.get(prompt) ?? 0) + 1;
        calls.set(prompt, n);
        if (failing.has(prompt)) return null;
        if (prompt === flaky && n === 1) throw new Error('overloaded');
        const group = groups.get(prompt) as Case[];
        const level = LEVELS.find((l) => group.every((c) => c.ok.includes(l)));
        return { text: `LEVEL: ${level}`, ms: 1, costUSD: 0.001 };
      },
    },
  );
  await fake.runCommand('gearbox', 'bench p/m', 'ses_bench');
  const out = fake.lastMessage();
  for (const prompt of failing) expect(calls.get(prompt), 'failed case retried once').toBe(2);
  expect(calls.get(flaky)).toBe(2);
  expect(out).toMatch(/answered: 72\/75/);
  expect(out).toMatch(/72\/72 \(100%\) of answered, 72\/75 \(96%\) of all/);
  expect(out).toMatch(/No answer \(3\)/);
  expect(out).not.toMatch(/Misses/);
  for (const [, [c]] of unique.slice(0, 3)) expect(out).toMatch(new RegExp(`\\b${c.id}\\b`));
  expect(
    metas.every((m: any) => m?.sessionID === 'ses_bench' && m?.sessionStats === false),
  ).toBeTruthy();
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
  expect(seen).toStrictEqual([['ses_h', 'full']]);
  expect(fake.lastMessage()).toMatch(/ses_new/);
  expect(fake.lastMessage()).toMatch(/HANDOFF\.md/);
});

test('handoff reports a failed file write in the toast', async () => {
  const fake = await setup(
    {},
    {
      handoff: async () => ({ newSessionID: 'ses_new', fileError: 'EACCES: permission denied' }),
    },
  );
  await fake.runCommand('gearbox', 'handoff full', 'ses_h');
  expect(fake.lastMessage()).toMatch(/ses_new/);
  expect(fake.lastMessage()).toMatch(/EACCES: permission denied/);
  expect(fake.toasts.at(-1)?.variant).toBe('warning');
});

test('handoff rejects unknown arguments', async () => {
  const seen: unknown[] = [];
  const fake = await setup(
    {},
    {
      handoff: async (_ctx, sessionID, mode) => {
        seen.push([sessionID, mode]);
        return { newSessionID: 'ses_new' };
      },
    },
  );
  await fake.runCommand('gearbox', 'handoff fulll', 'ses_h');
  expect(seen).toStrictEqual([]);
  expect(fake.lastMessage()).toMatch(/Usage: \/gearbox handoff \[full\]/);
  expect(fake.toasts.at(-1)?.variant).toBe('error');
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
  expect(seen).toStrictEqual([['ses_c', 'keep the parser notes']]);
  expect(fake.lastMessage()).toMatch(/note goes into the summary prompt/);
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
  await waitFor(() => (fake.storage.get('stats/ses_dbg') as any)?.requests === 1);
  await fake.runCommand('gearbox', 'debug', 'ses_dbg');
  expect(fake.lastMessage()).toMatch(/xhigh/);
  expect(fake.lastMessage()).toMatch(/hard bug/);
  expect(fake.lastMessage()).toMatch(/p\/m#xhigh/);
});

test('debug reads the request model from the session state', async () => {
  resetState('ses_dbg4');
  getState('ses_dbg4').requestModel = { providerID: 'p', id: 'm', variant: 'low' };
  const fake = await setup();
  await fake.runCommand('gearbox', 'debug', 'ses_dbg4');
  expect(fake.lastMessage()).toMatch(/Request model: p\/m#low/);
});

test('debug shows the raw judge answer', async () => {
  resetState('ses_dbg2');
  getState('ses_dbg2').judgeAnswer = 'I think xhigh, maybe';
  const fake = await setup();
  await fake.runCommand('gearbox', 'debug', 'ses_dbg2');
  expect(fake.lastMessage()).toMatch(/Judge answer: I think xhigh, maybe/);
});

test('debug says whether a judge call is still running', async () => {
  resetState('ses_dbg3');
  const state = getState('ses_dbg3');
  state.pending = Promise.resolve({ level: 'low', source: 'judge', reason: 'x' });
  const fake = await setup();
  await fake.runCommand('gearbox', 'debug', 'ses_dbg3');
  expect(fake.lastMessage()).toMatch(/Judge running: no/);
  state.judging = 1;
  await fake.runCommand('gearbox', 'debug', 'ses_dbg3');
  expect(fake.lastMessage()).toMatch(/Judge running: yes/);
});

test('status shows the effort pause of a model without effort control', async () => {
  resetState('ses_st2');
  getState('ses_st2').lastLevel = 'high';
  getState('ses_st2').effortPaused = 'no effort control';
  const fake = await setup();
  await fake.runCommand('gearbox', '', 'ses_st2');
  expect(fake.lastMessage()).toMatch(/Paused: no effort control/);
  expect(fake.lastMessage()).not.toMatch(/· Auto/);
});

test('status with no arguments shows level and auto state', async () => {
  resetState('ses_st');
  getState('ses_st').lastLevel = 'medium';
  const fake = await setup();
  await fake.runCommand('gearbox', '', 'ses_st');
  expect(fake.lastMessage()).toMatch(/medium/i);
  expect(fake.lastMessage()).toMatch(/Auto/);
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
  expect(fake.lastMessage()).toMatch(/boom/);
  expect(fake.toasts.at(-1)?.variant).toBe('error');
});
