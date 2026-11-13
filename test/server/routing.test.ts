import { afterEach, expect, mock, test } from 'bun:test';
import { makeFakeCtx } from '../fake-ctx.ts';
import type { FakeCtxOptions } from '../fake-ctx.ts';
import { registerRouting } from '../../src/server/routing.ts';
import { getState, resetState } from '../../src/server/state.ts';
import { DEFAULT_SETTINGS, LEVELS } from '../../src/core/types.ts';
import type { Settings } from '../../src/core/types.ts';

// Restore console spies even when a test fails: all test files share one Bun process.
afterEach(() => {
  mock.restore();
});

const SUBAGENT_PREFIX = 'You are a subagent spawned by another session.\n';

function model(id: string, output: number, extra: Record<string, unknown> = {}) {
  return {
    id,
    modelID: id,
    providerID: 'anthropic',
    capabilities: { tools: true },
    variants: [
      { id: 'none', settings: { thinking: { type: 'disabled' } } },
      ...LEVELS.map((level) => ({
        id: level,
        settings: { thinking: { type: 'adaptive' }, effort: level },
      })),
    ],
    cost: [{ input: output / 5, output, cache: { read: output / 50, write: output / 4 } }],
    enabled: true,
    limit: { context: 200000 },
    ...extra,
  };
}

const opus = model('claude-opus-5-5', 25);
const sonnet = model('claude-sonnet-5-5', 15);
const haiku = model('claude-haiku-5-5', 5);
const local = model('local-coder', 0, { providerID: 'local', variants: [] });
const MODELS = [opus, sonnet, haiku, local];

const OPUS = { providerID: 'anthropic', id: 'claude-opus-5-5' };
const HAIKU = { providerID: 'anthropic', id: 'claude-haiku-5-5' };

let counter = 0;
const newSession = () => `ses_routing_${++counter}`;

type Setup = FakeCtxOptions & { settings?: Partial<Settings> };

async function setup(opts: Setup = {}) {
  const settings: Settings = { ...structuredClone(DEFAULT_SETTINGS), ...opts.settings };
  // Sessions without a model run on OpenCode's default model: Opus here.
  const overrides: Record<string, any> = { ...opts.overrides };
  overrides.model = { default: async () => ({ data: opus }), ...overrides.model };
  const fake = makeFakeCtx({ models: MODELS, agents: [{ id: 'build' }], ...opts, overrides });
  await registerRouting(fake.ctx, { loadSettings: async () => settings });
  return fake;
}

function promptEvent(sessionID: string, text: string) {
  return { sessionID, messageID: 'msg_1', prompt: { text }, delivery: 'queue' };
}

function contextEvent(
  sessionID: string,
  ref: { providerID: string; id: string; variant?: string } = { ...OPUS, variant: 'default' },
) {
  return {
    sessionID,
    agent: 'build',
    model: ref,
    system: [],
    messages: [],
    tools: {},
    options: { maxTokens: 32000 } as Record<string, unknown>,
  };
}

/** Lets a status emit the `context` hook started without waiting for it to finish. */
const flush = () => new Promise((resolve) => setTimeout(resolve, 5));

function gate() {
  let open!: (text: string) => void;
  const promise = new Promise<{ text: string }>((resolve) => {
    open = (text) => resolve({ text });
  });
  return { promise, open };
}

test('prompt hook returns before the judge resolves; context applies the judged level', async () => {
  const sessionID = newSession();
  const judge = gate();
  const fake = await setup({ generateText: () => judge.promise });
  await fake.fire('prompt', promptEvent(sessionID, 'Refactor the auth module'));
  expect(getState(sessionID).pending, 'judge started').toBeTruthy();
  expect(getState(sessionID).judging, 'judge call running').toBe(1);
  judge.open('LEVEL: high\nWHY: multi-file refactor');
  const event = await fake.fire('context', contextEvent(sessionID));
  expect(getState(sessionID).judging, 'judge call settled').toBe(0);
  expect(event.options.effort).toBe('high');
  expect(event.options.thinking).toStrictEqual({ type: 'adaptive' });
  expect(event.options.maxTokens).toBe(32000);
  expect(getState(sessionID).lastLevel).toBe('high');
  expect(getState(sessionID).lastDecision?.source).toBe('judge');
  expect(getState(sessionID).lastDecision?.reason).toBe('multi-file refactor');
  expect(getState(sessionID).lastRequestAt, 'stamped from session.step.ended only').toBe(null);
  await flush();
  const status = fake.events.filter((e) => e.name === 'status').at(-1)?.payload as any;
  expect(status.level).toBe('high');
  expect(status.paused).toBe(null);
});

test('the turn decision applies on every context step', async () => {
  const sessionID = newSession();
  const fake = await setup({ generateText: async () => ({ text: 'LEVEL: xhigh' }) });
  await fake.fire('prompt', promptEvent(sessionID, 'Redesign the storage layer'));
  const first = await fake.fire('context', contextEvent(sessionID));
  const second = await fake.fire('context', contextEvent(sessionID));
  expect(first.options.effort).toBe('xhigh');
  expect(second.options.effort).toBe('xhigh');
  expect(fake.callsTo('generate.text').length).toBe(1);
});

test('a hanging model catalog does not hold the request', async () => {
  const sessionID = newSession();
  const fake = await setup({
    settings: { judge: { timeoutMs: 50 } },
    overrides: { model: { list: () => new Promise(() => {}) } },
  });
  await fake.fire('prompt', promptEvent(sessionID, 'max effort: fix it'));
  const late = new Promise((resolve) => setTimeout(() => resolve('hung'), 1000));
  const result = await Promise.race([fake.fire('context', contextEvent(sessionID)), late]);
  expect(result).not.toBe('hung');
});

test('a hanging session read does not hold a request whose prompt Gearbox never saw', async () => {
  // E.g. after a plugin reload mid-turn: nothing says yet whether the session is a subagent.
  const sessionID = newSession();
  const fake = await setup({
    settings: { judge: { timeoutMs: 50 } },
    overrides: { session: { get: () => new Promise(() => {}) } },
  });
  const late = new Promise((resolve) => setTimeout(() => resolve('hung'), 1000));
  const result = await Promise.race([fake.fire('context', contextEvent(sessionID)), late]);
  expect(result).not.toBe('hung');
  expect((result as any).options, 'left alone').toStrictEqual({ maxTokens: 32000 });
});

function userMessage(id: string, text: string) {
  return { id, role: 'user', content: [{ type: 'text', text }] };
}

test('a prompt queued during a turn does not change that turn’s effort', async () => {
  const sessionID = newSession();
  const fake = await setup({
    generateText: async ({ prompt }: { prompt: string }) => ({
      text: prompt.includes('Redesign') ? 'LEVEL: xhigh' : 'LEVEL: low',
    }),
  });
  const first = userMessage('msg_A', 'Redesign the storage layer');
  await fake.fire('prompt', {
    ...promptEvent(sessionID, 'Redesign the storage layer'),
    messageID: 'msg_A',
  });
  const step1 = await fake.fire('context', { ...contextEvent(sessionID), messages: [first] });
  // The user queues the next prompt while the first turn is still running (probe: its hook
  // fires at once, before the first turn's remaining steps).
  await fake.fire('prompt', { ...promptEvent(sessionID, 'say hi'), messageID: 'msg_B' });
  const step2 = await fake.fire('context', { ...contextEvent(sessionID), messages: [first] });
  expect(getState(sessionID).requestTurn, 'still the first turn').toBe('msg_A');
  const next = await fake.fire('context', {
    ...contextEvent(sessionID),
    messages: [first, userMessage('msg_B', 'say hi')],
  });
  expect(step1.options.effort).toBe('xhigh');
  expect(step2.options.effort, 'first turn keeps its level').toBe('xhigh');
  expect(next.options.effort, 'the queued prompt gets its own level').toBe('low');
  expect(getState(sessionID).requestTurn).toBe('msg_B');
});

test('the judge sees the reply the prompt answers, read from the session', async () => {
  const sessionID = newSession();
  const fake = await setup({
    generateText: async () => ({ text: 'LEVEL: medium' }),
    overrides: {
      session: {
        // The reply was written by the last request of the previous turn: no `context` hook
        // carried it, so only the session's messages hold it.
        context: async () => [
          { id: 'u1', type: 'user', text: 'Should I refactor or patch?' },
          {
            id: 'a1',
            type: 'assistant',
            content: [{ type: 'text', text: 'A) full refactor, B) quick patch. Which one?' }],
          },
        ],
      },
    },
  });
  await fake.fire('prompt', promptEvent(sessionID, 'B'));
  await fake.fire('context', contextEvent(sessionID));
  const [call] = fake.callsTo('generate.text');
  expect((call.input as { prompt: string }).prompt).toContain(
    '<reply>\nA) full refactor, B) quick patch. Which one?\n</reply>',
  );
});

test('a hanging session read still judges the prompt, without a reply', async () => {
  const sessionID = newSession();
  const fake = await setup({
    settings: { judge: { timeoutMs: 50 } },
    generateText: async () => ({ text: 'LEVEL: high' }),
    overrides: { session: { context: () => new Promise(() => {}) } },
  });
  await fake.fire('prompt', promptEvent(sessionID, 'Debug the flaky upload test'));
  const event = await fake.fire('context', contextEvent(sessionID));
  expect(event.options.effort).toBe('high');
  const [call] = fake.callsTo('generate.text');
  expect((call.input as { prompt: string }).prompt).not.toContain('<reply>');
});

test('the request level is cleared even when reading the settings fails', async () => {
  const sessionID = newSession();
  const fake = makeFakeCtx({ models: MODELS });
  let fail = false;
  const settings = structuredClone(DEFAULT_SETTINGS);
  await registerRouting(fake.ctx, {
    loadSettings: async () => {
      if (fail) throw new Error('storage down');
      return settings;
    },
  });
  getState(sessionID).requestLevel = 'max';
  fail = true;
  await fake.fire('context', contextEvent(sessionID));
  expect(getState(sessionID).requestLevel).toBe(null);
});

test('the effort level of the request is recorded only when Gearbox set it', async () => {
  const sessionID = newSession();
  const fake = await setup({ generateText: async () => ({ text: 'LEVEL: high' }) });
  await fake.fire('prompt', promptEvent(sessionID, 'Refactor the auth module'));
  await fake.fire('context', contextEvent(sessionID));
  expect(getState(sessionID).requestLevel).toBe('high');
  // A manual variant pauses Gearbox: the request runs at the user's level, not Gearbox's.
  await fake.fire('prompt', promptEvent(sessionID, 'Refactor the auth module'));
  await fake.fire('context', contextEvent(sessionID, { ...OPUS, variant: 'max' }));
  expect(getState(sessionID).requestLevel).toBe(null);
});

test('follow-up reuses the last level without a judge call', async () => {
  const sessionID = newSession();
  const fake = await setup({ generateText: async () => ({ text: 'LEVEL: xhigh' }) });
  await fake.fire('prompt', promptEvent(sessionID, 'Debug this race condition'));
  await fake.fire('context', contextEvent(sessionID));
  await fake.fire('prompt', promptEvent(sessionID, 'ok'));
  const event = await fake.fire('context', contextEvent(sessionID));
  expect(event.options.effort).toBe('xhigh');
  expect(getState(sessionID).lastDecision?.source).toBe('followup');
  expect(fake.callsTo('generate.text').length).toBe(1);
  expect(getState(sessionID).userTurn).toBe(2);
});

test('named level skips the judge', async () => {
  const sessionID = newSession();
  const fake = await setup({ generateText: async () => ({ text: 'LEVEL: max' }) });
  await fake.fire('prompt', promptEvent(sessionID, 'low effort: fix the typo'));
  const event = await fake.fire('context', contextEvent(sessionID));
  expect(event.options.effort).toBe('low');
  expect(getState(sessionID).lastDecision?.source).toBe('named');
  expect(fake.callsTo('generate.text').length).toBe(0);
});

test('settings shape the level: bias and ceiling', async () => {
  const sessionID = newSession();
  const fake = await setup({
    settings: { bias: 1, ceiling: 'xhigh' },
    generateText: async () => ({ text: 'LEVEL: high' }),
  });
  await fake.fire('prompt', promptEvent(sessionID, 'Refactor the auth module'));
  const event = await fake.fire('context', contextEvent(sessionID));
  expect(event.options.effort).toBe('xhigh');
  expect(getState(sessionID).lastLevel, 'raw level kept for follow-ups').toBe('high');
  await fake.fire('prompt', promptEvent(sessionID, 'continue'));
  const next = await fake.fire('context', contextEvent(sessionID));
  expect(next.options.effort, 'bias is not applied twice').toBe('xhigh');
});

test('judge timeout falls back to medium within timeoutMs + 50 ms', async () => {
  const sessionID = newSession();
  const fake = await setup({
    settings: { judge: { timeoutMs: 100 } },
    generateText: () => new Promise(() => {}),
  });
  const start = Date.now();
  await fake.fire('prompt', promptEvent(sessionID, 'Refactor the auth module'));
  const event = await fake.fire('context', contextEvent(sessionID));
  expect(Date.now() - start <= 150, `took ${Date.now() - start} ms`).toBeTruthy();
  expect(event.options.effort).toBe('medium');
  expect(getState(sessionID).lastDecision?.source).toBe('fallback');
});

test('judge error or garbage falls back to the last level', async () => {
  const sessionID = newSession();
  let answer: () => Promise<{ text: string }> = async () => ({ text: 'LEVEL: high' });
  const fake = await setup({ generateText: () => answer() });
  await fake.fire('prompt', promptEvent(sessionID, 'Refactor the auth module'));
  await fake.fire('context', contextEvent(sessionID));

  answer = async () => {
    throw new Error('Insufficient balance');
  };
  await fake.fire('prompt', promptEvent(sessionID, 'Now split the module'));
  const thrown = await fake.fire('context', contextEvent(sessionID));
  expect(thrown.options.effort).toBe('high');
  expect(getState(sessionID).lastDecision?.source).toBe('fallback');

  answer = async () => ({ text: 'banana' });
  await fake.fire('prompt', promptEvent(sessionID, 'And add tests for it'));
  const garbage = await fake.fire('context', contextEvent(sessionID));
  expect(garbage.options.effort).toBe('high');
});

test('a routing failure leaves the request unchanged and does not throw', async () => {
  const sessionID = newSession();
  const fake = await setup({
    generateText: async () => ({ text: 'LEVEL: low' }),
    overrides: {
      model: {
        list: async () => {
          throw new Error('model service down');
        },
      },
    },
  });
  await fake.fire('prompt', promptEvent(sessionID, 'Refactor the auth module'));
  const event = await fake.fire('context', contextEvent(sessionID));
  expect(event.options).toStrictEqual({ maxTokens: 32000 });
  expect(event.model).toStrictEqual({ ...OPUS, variant: 'default' });
});

test('manual variant pauses auto with one toast until auto is turned back on', async () => {
  const sessionID = newSession();
  const fake = await setup({
    sessions: { [sessionID]: { id: sessionID, model: { ...OPUS, variant: 'high' } } },
    generateText: async () => ({ text: 'LEVEL: low' }),
  });
  await fake.fire('prompt', promptEvent(sessionID, 'Refactor the auth module'));
  expect(fake.callsTo('generate.text').length, 'no judge while paused').toBe(0);
  const first = await fake.fire('context', contextEvent(sessionID, { ...OPUS, variant: 'high' }));
  const second = await fake.fire('context', contextEvent(sessionID, { ...OPUS, variant: 'high' }));
  expect(first.options).toStrictEqual({ maxTokens: 32000 });
  expect(second.options).toStrictEqual({ maxTokens: 32000 });
  expect(first.model).toStrictEqual({ ...OPUS, variant: 'high' });
  expect(getState(sessionID).autoPaused).toBe('manual variant');
  expect(fake.toasts.length).toBe(1);
  expect(fake.toasts[0].message).toMatch(/auto on/);

  // `/gearbox auto on` clears autoPaused (Task 8); the same variant no longer pauses.
  getState(sessionID).autoPaused = null;
  await fake.fire('prompt', promptEvent(sessionID, 'use low effort and rename it'));
  const resumed = await fake.fire('context', contextEvent(sessionID, { ...OPUS, variant: 'high' }));
  expect(resumed.options.effort).toBe('low');
  expect(fake.toasts.length).toBe(1);
});

test('auto on before the first prompt accepts the variant the session already has', async () => {
  const sessionID = newSession();
  const fake = await setup({
    sessions: { [sessionID]: { id: sessionID, model: { ...OPUS, variant: 'high' } } },
    generateText: async () => ({ text: 'LEVEL: low' }),
  });
  // `/gearbox auto on` right after OpenCode starts: no prompt seen yet.
  getState(sessionID).acceptVariant = true;
  await fake.fire('prompt', promptEvent(sessionID, 'Refactor the auth module'));
  const event = await fake.fire('context', contextEvent(sessionID, { ...OPUS, variant: 'high' }));
  expect(getState(sessionID).autoPaused).toBe(null);
  expect(event.options.effort).toBe('low');
  expect(fake.toasts.length).toBe(0);

  // A variant picked after that is the user's again.
  await fake.fire('prompt', promptEvent(sessionID, 'Refactor the auth module'));
  const picked = await fake.fire('context', contextEvent(sessionID, { ...OPUS, variant: 'max' }));
  expect(getState(sessionID).autoPaused).toBe('manual variant');
  expect(picked.options).toStrictEqual({ maxTokens: 32000 });
});

test('auto on accepts only the next variant seen, not a later pick', async () => {
  const sessionID = newSession();
  const fake = await setup({
    sessions: { [sessionID]: { id: sessionID, model: OPUS } },
    generateText: async () => ({ text: 'LEVEL: low' }),
  });
  getState(sessionID).acceptVariant = true;
  await fake.fire('prompt', promptEvent(sessionID, 'Refactor the auth module'));
  await fake.fire('context', contextEvent(sessionID));
  expect(getState(sessionID).acceptVariant).toBe(false);
  await fake.fire('prompt', promptEvent(sessionID, 'Refactor the auth module'));
  await fake.fire('context', contextEvent(sessionID, { ...OPUS, variant: 'high' }));
  expect(getState(sessionID).autoPaused).toBe('manual variant');
});

test('subagent whose agent has an explicit model keeps it and gets effort', async () => {
  const sessionID = newSession();
  const fake = await setup({
    sessions: {
      [sessionID]: {
        id: sessionID,
        parentID: 'ses_root',
        agent: 'pinned',
        model: { ...OPUS, variant: 'medium' },
      },
    },
    agents: [{ id: 'pinned', model: { ...OPUS, variant: 'medium' } }],
    generateText: async () => ({ text: 'LEVEL: low' }),
  });
  await fake.fire('prompt', promptEvent(sessionID, `${SUBAGENT_PREFIX}Find the config loader`));
  expect(fake.callsTo('session.switchModel').length).toBe(0);
  const event = await fake.fire('context', contextEvent(sessionID, { ...OPUS, variant: 'medium' }));
  expect(event.options.effort, 'effort applied, subagent variant is not manual').toBe('low');
  expect(event.model).toStrictEqual({ ...OPUS, variant: 'medium' });
  expect(getState(sessionID).isSubagent).toBe(true);
});

test('subagent without an explicit model moves to the cheapest ladder model at low', async () => {
  const sessionID = newSession();
  const fake = await setup({
    sessions: {
      [sessionID]: { id: sessionID, parentID: 'ses_root', agent: 'general', model: OPUS },
    },
    agents: [{ id: 'general' }],
    generateText: async () => ({ text: 'LEVEL: low\nWHY: lookup' }),
  });
  await fake.fire('prompt', promptEvent(sessionID, `${SUBAGENT_PREFIX}Find the config loader`));
  const switches = fake.callsTo('session.switchModel');
  expect(switches.length).toBe(1);
  expect(switches[0].input).toStrictEqual({
    sessionID,
    model: { providerID: 'anthropic', id: 'claude-haiku-5-5', variant: 'low' },
  });
  const judged = fake.callsTo('generate.text')[0].input as { prompt: string };
  expect(!judged.prompt.includes('You are a subagent'), 'prefix stripped').toBeTruthy();
  expect(judged.prompt).toMatch(/Find the config loader/);
  expect(judged.prompt).toMatch(/subagent/);
});

test('subagent routing skips cheaper models without effort variants', async () => {
  const sessionID = newSession();
  const flash = model('flash', 1, { variants: [] });
  const fake = await setup({
    models: [...MODELS, flash],
    sessions: {
      [sessionID]: { id: sessionID, parentID: 'ses_root', agent: 'general', model: OPUS },
    },
    agents: [{ id: 'general' }],
    generateText: async () => ({ text: 'LEVEL: low' }),
  });
  await fake.fire('prompt', promptEvent(sessionID, `${SUBAGENT_PREFIX}low effort: list files`));
  const [call] = fake.callsTo('session.switchModel');
  expect((call.input as any).model).toStrictEqual({ ...HAIKU, variant: 'low' });
});

test('subagent routing skips older dearer models and rungs whose lowest effort is too high', async () => {
  // The 2026-11-12 Sonnet bench: medium subagents ran on claude-haiku-4-5 at `high`.
  const sessionID = newSession();
  const OCT_2025 = 1760486400000;
  const SEP_2026 = 1790553600000;
  const NOV_2026 = 1794182400000;
  const dated = { time: { released: NOV_2026 } };
  const old = model('claude-haiku-4-5', 5, {
    family: 'claude-haiku',
    time: { released: OCT_2025 },
    variants: [
      { id: 'high', settings: { thinking: { type: 'enabled', budgetTokens: 16000 } } },
      { id: 'max', settings: { thinking: { type: 'enabled', budgetTokens: 32000 } } },
    ],
  });
  const fake = await setup({
    models: [
      { ...opus, ...dated, family: 'claude-opus' },
      { ...sonnet, ...dated, family: 'claude-sonnet' },
      model('claude-haiku-5-5', 0.5, { family: 'claude-haiku', time: { released: SEP_2026 } }),
      old,
      { ...old, id: 'claude-haiku-4-5-budget', time: { released: NOV_2026 } },
    ],
    sessions: {
      [sessionID]: { id: sessionID, parentID: 'ses_root', agent: 'general', model: OPUS },
    },
    agents: [{ id: 'general' }],
    generateText: async () => ({ text: 'LEVEL: medium' }),
  });
  await fake.fire('prompt', promptEvent(sessionID, `${SUBAGENT_PREFIX}Add a field and its test`));
  const [call] = fake.callsTo('session.switchModel');
  // Ladder after pruning: haiku-5-5, haiku-4-5-budget (high+ only), sonnet, opus. Without
  // `fitRungs`, medium would land on haiku-4-5-budget at `high`.
  expect((call.input as any).model).toStrictEqual({
    providerID: 'anthropic',
    id: 'claude-sonnet-5-5',
    variant: 'medium',
  });
});

test('subagent model switching off keeps the model', async () => {
  const sessionID = newSession();
  const fake = await setup({
    settings: { modelSwitch: { subagents: false, minSavingRatio: 0.2 } },
    sessions: {
      [sessionID]: { id: sessionID, parentID: 'ses_root', agent: 'general', model: OPUS },
    },
    agents: [{ id: 'general' }],
    generateText: async () => ({ text: 'LEVEL: low' }),
  });
  await fake.fire('prompt', promptEvent(sessionID, `${SUBAGENT_PREFIX}Find the config loader`));
  expect(fake.callsTo('session.switchModel').length).toBe(0);
});

test('main chat never switches the model', async () => {
  const sessionID = newSession();
  const fake = await setup({
    generateText: async () => ({ text: 'LEVEL: low' }),
  });
  await fake.fire('prompt', promptEvent(sessionID, 'What does this function do?'));
  const event = await fake.fire('context', contextEvent(sessionID));
  expect(event.model).toStrictEqual({ ...OPUS, variant: 'default' });
  expect(event.options.effort).toBe('low');
  expect(fake.callsTo('session.switchModel').length).toBe(0);
  expect(fake.hooks.has('experimental.model.resolve')).toBe(false);
});

test('a target without effort variants gets no variant and shows paused status', async () => {
  const sessionID = newSession();
  const fake = await setup({ generateText: async () => ({ text: 'LEVEL: high' }) });
  await fake.fire('prompt', promptEvent(sessionID, 'Refactor the auth module'));
  const ref = { providerID: 'local', id: 'local-coder', variant: 'default' };
  const event = await fake.fire('context', contextEvent(sessionID, ref));
  expect(event.options).toStrictEqual({ maxTokens: 32000 });
  expect(event.model).toStrictEqual(ref);
  await flush();
  const status = fake.events.filter((e) => e.name === 'status').at(-1)?.payload as any;
  expect(status.paused).toBe('no effort control');
  expect(getState(sessionID).autoPaused, 'not a sticky pause').toBe(null);
});

test('auto off or a model outside effortModels changes nothing and skips the judge', async () => {
  for (const settings of [{ auto: false }, { effortModels: '^gpt-' }]) {
    const sessionID = newSession();
    const fake = await setup({ settings, generateText: async () => ({ text: 'LEVEL: max' }) });
    await fake.fire('prompt', promptEvent(sessionID, 'Refactor the auth module'));
    const event = await fake.fire('context', contextEvent(sessionID));
    expect(event.options).toStrictEqual({ maxTokens: 32000 });
    expect(fake.callsTo('generate.text').length).toBe(0);
  }
});

const tick = () => new Promise((resolve) => setTimeout(resolve, 10));

test('lastRequestAt is stamped from session.step.ended', async () => {
  const sessionID = newSession();
  const fake = await setup({ generateText: async () => ({ text: 'LEVEL: low' }) });
  await fake.fire('prompt', promptEvent(sessionID, 'What does this function do?'));
  await fake.fire('context', contextEvent(sessionID));
  expect(getState(sessionID).lastRequestAt).toBe(null);
  fake.publish({
    type: 'session.step.ended',
    data: { sessionID, tokens: { input: 10, output: 1, cache: { read: 0, write: 0 } } },
  });
  await tick();
  expect(getState(sessionID).lastRequestAt).toBeTruthy();
});

test('a target without effort variants stores the effort pause in state', async () => {
  const sessionID = newSession();
  const fake = await setup({ generateText: async () => ({ text: 'LEVEL: high' }) });
  await fake.fire('prompt', promptEvent(sessionID, 'Refactor the auth module'));
  await fake.fire('context', contextEvent(sessionID, { providerID: 'local', id: 'local-coder' }));
  expect(getState(sessionID).effortPaused).toBe('no effort control');
  await fake.fire('prompt', promptEvent(sessionID, 'ok'));
  await fake.fire('context', contextEvent(sessionID));
  expect(getState(sessionID).effortPaused).toBe(null);
});

test('the raw judge answer is kept for /gearbox debug', async () => {
  const sessionID = newSession();
  const fake = await setup({ generateText: async () => ({ text: 'banana' }) });
  await fake.fire('prompt', promptEvent(sessionID, 'Refactor the auth module'));
  await fake.fire('context', contextEvent(sessionID));
  expect(getState(sessionID).judgeAnswer).toBe('banana');
});

test('model.list is read once per step across judge, routing and status', async () => {
  const sessionID = newSession();
  const fake = await setup({ generateText: async () => ({ text: 'LEVEL: high' }) });
  await fake.fire('prompt', promptEvent(sessionID, 'Refactor the auth module'));
  await fake.fire('context', contextEvent(sessionID));
  await fake.fire('context', contextEvent(sessionID));
  expect(fake.callsTo('model.list').length).toBe(1);
});

test('subagent prompt hook with a hanging judge returns within timeoutMs + 50 ms', async () => {
  const sessionID = newSession();
  const fake = await setup({
    settings: { judge: { timeoutMs: 100 } },
    sessions: {
      [sessionID]: { id: sessionID, parentID: 'ses_root', agent: 'general', model: OPUS },
    },
    agents: [{ id: 'general' }],
    generateText: () => new Promise(() => {}),
  });
  const start = Date.now();
  await fake.fire('prompt', promptEvent(sessionID, `${SUBAGENT_PREFIX}Refactor the auth module`));
  expect(Date.now() - start <= 150, `took ${Date.now() - start} ms`).toBeTruthy();
});

test('subagent with an unknown agent keeps its model', async () => {
  const sessionID = newSession();
  const fake = await setup({
    sessions: {
      [sessionID]: { id: sessionID, parentID: 'ses_root', agent: 'ghost', model: OPUS },
    },
    generateText: async () => ({ text: 'LEVEL: low' }),
  });
  await fake.fire('prompt', promptEvent(sessionID, `${SUBAGENT_PREFIX}Find the config loader`));
  expect(fake.callsTo('session.switchModel').length).toBe(0);
});

test('subagent with an empty ladder gets effort only', async () => {
  const sessionID = newSession();
  const flat = model('flat', 0, { providerID: 'sub', cost: [] });
  const ref = { providerID: 'sub', id: 'flat' };
  const fake = await setup({
    models: [flat],
    sessions: {
      [sessionID]: { id: sessionID, parentID: 'ses_root', agent: 'general', model: ref },
    },
    agents: [{ id: 'general' }],
    generateText: async () => ({ text: 'LEVEL: low' }),
  });
  await fake.fire('prompt', promptEvent(sessionID, `${SUBAGENT_PREFIX}low effort: list files`));
  expect(fake.callsTo('session.switchModel').length).toBe(0);
  const event = await fake.fire('context', contextEvent(sessionID, ref));
  expect(event.options.effort).toBe('low');
});

/** One finished request of `sessionID` on `ref`, with `cached` context tokens read from cache. */
async function request(
  fake: Awaited<ReturnType<typeof setup>>,
  sessionID: string,
  ref: object,
  cached: number,
) {
  fake.publish({ type: 'session.step.started', data: { sessionID, model: ref } });
  fake.publish({
    type: 'session.step.ended',
    data: { sessionID, tokens: { input: 0, output: 10, cache: { read: cached, write: 0 } } },
  });
  await tick();
}

async function resumedSubagent(cached: number, second: string) {
  const sessionID = newSession();
  const sessions: Record<string, any> = {
    [sessionID]: { id: sessionID, parentID: 'ses_root', agent: 'general', model: OPUS },
  };
  const fake = await setup({
    sessions,
    agents: [{ id: 'general' }],
    generateText: async () => ({ text: 'LEVEL: low' }),
  });
  await fake.fire('prompt', promptEvent(sessionID, `${SUBAGENT_PREFIX}max effort: plan it`));
  // The switch persists on the session.
  sessions[sessionID].model = { ...OPUS, variant: 'max' };
  await request(fake, sessionID, { ...OPUS, variant: 'max' }, cached);
  await fake.fire('prompt', promptEvent(sessionID, second));
  return fake.callsTo('session.switchModel').map((call) => (call.input as any).model);
}

test('a resumed subagent with a warm large context keeps its model', async () => {
  const models = await resumedSubagent(150_000, 'low effort: list the files');
  expect(models).toStrictEqual([{ ...OPUS, variant: 'max' }]);
});

test('a resumed subagent with no context moves down when that is cheaper', async () => {
  const models = await resumedSubagent(0, 'low effort: list the files');
  expect(models).toStrictEqual([
    { ...OPUS, variant: 'max' },
    { ...HAIKU, variant: 'low' },
  ]);
});

test('a resumed subagent never switches to a pricier model', async () => {
  const sessionID = newSession();
  const sessions: Record<string, any> = {
    [sessionID]: { id: sessionID, parentID: 'ses_root', agent: 'general', model: OPUS },
  };
  const fake = await setup({
    sessions,
    agents: [{ id: 'general' }],
    generateText: async () => ({ text: 'LEVEL: low' }),
  });
  await fake.fire('prompt', promptEvent(sessionID, `${SUBAGENT_PREFIX}low effort: list files`));
  sessions[sessionID].model = { ...HAIKU, variant: 'low' };
  await request(fake, sessionID, { ...HAIKU, variant: 'low' }, 0);
  await fake.fire('prompt', promptEvent(sessionID, 'max effort: now redesign the module'));
  const switches = fake.callsTo('session.switchModel');
  expect(switches.length, 'only the first prompt switched').toBe(1);
  // The level still rises through effort.
  const event = await fake.fire('context', contextEvent(sessionID, { ...HAIKU, variant: 'low' }));
  expect(event.options.effort).toBe('max');
});

test('a subagent of a session paused by a manual variant is left alone', async () => {
  const root = newSession();
  const mid = newSession();
  const child = newSession();
  const fake = await setup({
    sessions: {
      [root]: { id: root, model: { ...OPUS, variant: 'high' } },
      [mid]: { id: mid, parentID: root, agent: 'general', model: { ...OPUS, variant: 'high' } },
      [child]: { id: child, parentID: mid, agent: 'general', model: { ...OPUS, variant: 'high' } },
    },
    agents: [{ id: 'build' }, { id: 'general' }],
    generateText: async () => ({ text: 'LEVEL: low' }),
  });
  await fake.fire('prompt', promptEvent(root, 'Refactor the auth module'));
  expect(getState(root).autoPaused).toBe('manual variant');
  for (const sessionID of [mid, child]) {
    await fake.fire('prompt', promptEvent(sessionID, `${SUBAGENT_PREFIX}Find the config loader`));
    const event = await fake.fire('context', contextEvent(sessionID, { ...OPUS, variant: 'high' }));
    expect(event.options).toStrictEqual({ maxTokens: 32000 });
  }
  expect(fake.callsTo('session.switchModel').length).toBe(0);
  expect(fake.callsTo('generate.text').length).toBe(0);
});

test('subagent without an agent on its Session.Info keeps its model', async () => {
  const sessionID = newSession();
  const fake = await setup({
    sessions: { [sessionID]: { id: sessionID, parentID: 'ses_root', model: OPUS } },
    generateText: async () => ({ text: 'LEVEL: low' }),
  });
  await fake.fire('prompt', promptEvent(sessionID, `${SUBAGENT_PREFIX}Find the config loader`));
  expect(fake.callsTo('session.switchModel').length).toBe(0);
});

test('a manual-variant prompt is admitted without waiting for the status build', async () => {
  const sessionID = newSession();
  const fake = await setup({
    sessions: { [sessionID]: { id: sessionID, model: { ...OPUS, variant: 'high' } } },
    generateText: async () => ({ text: 'LEVEL: low' }),
  });
  // The status reads settings from storage; a hanging store must not hold up admission.
  fake.ctx.storage.get = () => new Promise(() => {});
  const admitted = await Promise.race([
    fake.fire('prompt', promptEvent(sessionID, 'Refactor the auth module')).then(() => true),
    new Promise((resolve) => setTimeout(() => resolve(false), 100)),
  ]);
  expect(admitted).toBe(true);
  expect(getState(sessionID).autoPaused).toBe('manual variant');
});

async function childWithoutModel(
  ancestors: Record<string, any>,
  parentID: string,
  extra: Setup = {},
) {
  const sessionID = newSession();
  const fake = await setup({
    sessions: { ...ancestors, [sessionID]: { id: sessionID, parentID, agent: 'general' } },
    agents: [{ id: 'build' }, { id: 'general' }],
    generateText: async () => ({ text: 'LEVEL: low' }),
    ...extra,
  });
  await fake.fire('prompt', promptEvent(sessionID, `${SUBAGENT_PREFIX}low effort: list files`));
  return { fake, sessionID };
}

test('a subagent without a model is routed from its parent model', async () => {
  const root = newSession();
  const { fake, sessionID } = await childWithoutModel({ [root]: { id: root, model: OPUS } }, root);
  const [call] = fake.callsTo('session.switchModel');
  expect(call?.input).toStrictEqual({ sessionID, model: { ...HAIKU, variant: 'low' } });
  expect(getState(sessionID).firstModel).toStrictEqual(OPUS);
});

test('a subagent without a model anywhere is routed from the default model', async () => {
  const root = newSession();
  const { fake } = await childWithoutModel({ [root]: { id: root } }, root);
  const [call] = fake.callsTo('session.switchModel');
  expect((call?.input as any)?.model).toStrictEqual({ ...HAIKU, variant: 'low' });
});

test('a subagent that inherits a manually picked variant keeps its model', async () => {
  const root = newSession();
  const mid = newSession();
  const { fake } = await childWithoutModel(
    {
      [root]: { id: root, model: OPUS },
      [mid]: { id: mid, parentID: root, agent: 'general', model: { ...OPUS, variant: 'high' } },
    },
    mid,
  );
  expect(fake.callsTo('session.switchModel').length).toBe(0);
});

test('an inherited model outside effortModels is left alone', async () => {
  const root = newSession();
  const { fake } = await childWithoutModel({ [root]: { id: root, model: OPUS } }, root, {
    settings: { effortModels: '^gpt-' },
  });
  expect(fake.callsTo('session.switchModel').length).toBe(0);
  expect(fake.callsTo('generate.text').length).toBe(0);
});

test('a manual variant on the root Session.Info pauses its subagents before the root prompts', async () => {
  const root = newSession();
  const child = newSession();
  const fake = await setup({
    sessions: {
      [root]: { id: root, model: { ...OPUS, variant: 'high' } },
      [child]: { id: child, parentID: root, agent: 'general', model: OPUS },
    },
    agents: [{ id: 'build' }, { id: 'general' }],
    generateText: async () => ({ text: 'LEVEL: low' }),
  });
  await fake.fire('prompt', promptEvent(child, `${SUBAGENT_PREFIX}Find the config loader`));
  const event = await fake.fire('context', contextEvent(child, OPUS));
  expect(event.options).toStrictEqual({ maxTokens: 32000 });
  expect(fake.callsTo('session.switchModel').length).toBe(0);
  expect(fake.callsTo('generate.text').length).toBe(0);
});

test('a root variant accepted with auto on no longer pauses its subagents', async () => {
  const root = newSession();
  const child = newSession();
  const fake = await setup({
    sessions: {
      [root]: { id: root, model: { ...OPUS, variant: 'high' } },
      [child]: { id: child, parentID: root, agent: 'general', model: OPUS },
    },
    agents: [{ id: 'build' }, { id: 'general' }],
    generateText: async () => ({ text: 'LEVEL: low' }),
  });
  await fake.fire('prompt', promptEvent(root, 'Refactor the auth module'));
  getState(root).autoPaused = null; // `/gearbox auto on`
  await fake.fire('prompt', promptEvent(child, `${SUBAGENT_PREFIX}low effort: list files`));
  expect(fake.callsTo('session.switchModel').length).toBe(1);
});

test('a prompt hook with a hanging session.get returns within timeoutMs + 50 ms', async () => {
  const sessionID = newSession();
  const fake = await setup({
    settings: { judge: { timeoutMs: 100 } },
    generateText: async () => ({ text: 'LEVEL: low' }),
    overrides: { session: { get: () => new Promise(() => {}) } },
  });
  const start = Date.now();
  await fake.fire('prompt', promptEvent(sessionID, `${SUBAGENT_PREFIX}Find the config loader`));
  expect(Date.now() - start <= 150, `took ${Date.now() - start} ms`).toBeTruthy();
});

test('a subagent whose parent lookup hangs returns in time and never switches late', async () => {
  const child = newSession();
  const info = { id: child, parentID: 'ses_hanging', agent: 'general', model: OPUS };
  const fake = await setup({
    settings: { judge: { timeoutMs: 100 } },
    agents: [{ id: 'general' }],
    generateText: async () => ({ text: 'LEVEL: low' }),
    overrides: {
      session: {
        get: async (input: any) => (input?.sessionID === child ? info : new Promise(() => {})),
      },
    },
  });
  const start = Date.now();
  await fake.fire('prompt', promptEvent(child, `${SUBAGENT_PREFIX}low effort: list files`));
  expect(Date.now() - start <= 150, `took ${Date.now() - start} ms`).toBeTruthy();
  await new Promise((resolve) => setTimeout(resolve, 150));
  expect(fake.callsTo('session.switchModel').length).toBe(0);
});

test('a subagent waits for the judge and its reads at most timeoutMs + 50 ms in total', async () => {
  const child = newSession();
  const root = newSession();
  const slow = (value: unknown) => new Promise((resolve) => setTimeout(() => resolve(value), 60));
  const sessions: Record<string, any> = {
    [root]: { id: root, model: OPUS },
    [child]: { id: child, parentID: root, agent: 'general', model: OPUS },
  };
  const fake = await setup({
    settings: { judge: { timeoutMs: 100 } },
    agents: [{ id: 'general' }],
    generateText: () => new Promise(() => {}),
    overrides: { session: { get: (input: any) => slow(sessions[input?.sessionID]) } },
  });
  const start = Date.now();
  await fake.fire('prompt', promptEvent(child, `${SUBAGENT_PREFIX}Refactor the auth module`));
  expect(Date.now() - start <= 150, `took ${Date.now() - start} ms`).toBeTruthy();
});

test('a subagent judge answer after the prompt deadline still sets the effort', async () => {
  const child = newSession();
  const root = newSession();
  const slow = (value: unknown) => new Promise((resolve) => setTimeout(() => resolve(value), 30));
  const sessions: Record<string, any> = {
    [root]: { id: root, model: OPUS },
    [child]: { id: child, parentID: root, agent: 'general', model: OPUS },
  };
  const fake = await setup({
    settings: { judge: { timeoutMs: 100 } },
    agents: [{ id: 'general' }],
    // Starts after ~60 ms of session reads, answers ~70 ms later: inside its own timeout, but
    // after the prompt hook's deadline.
    generateText: () =>
      new Promise((resolve) => setTimeout(() => resolve({ text: 'LEVEL: low' }), 70)),
    overrides: { session: { get: (input: any) => slow(sessions[input?.sessionID]) } },
  });
  await fake.fire('prompt', promptEvent(child, `${SUBAGENT_PREFIX}Find the config loader`));
  const event = await fake.fire('context', contextEvent(child, OPUS));
  expect(event.options.effort).toBe('low');
  expect(getState(child).lastDecision?.source).toBe('judge');
});

test('the request turn is the prompt’s message ID, so a restart never repeats it', async () => {
  const sessionID = newSession();
  const fake = await setup({ generateText: async () => ({ text: 'LEVEL: low' }) });
  const first = userMessage('msg_A', 'Rename x');
  await fake.fire('prompt', { ...promptEvent(sessionID, 'Rename x'), messageID: 'msg_A' });
  await fake.fire('context', { ...contextEvent(sessionID), messages: [first] });
  expect(getState(sessionID).requestTurn).toBe('msg_A');
  // A restart loses the in-memory turn counter; the next prompt still gets its own turn.
  resetState(sessionID);
  await fake.fire('prompt', { ...promptEvent(sessionID, 'Rename y'), messageID: 'msg_B' });
  await fake.fire('context', {
    ...contextEvent(sessionID),
    messages: [first, userMessage('msg_B', 'Rename y')],
  });
  expect(getState(sessionID).requestTurn).toBe('msg_B');
});

test('a request is sent without waiting for the status build', async () => {
  const sessionID = newSession();
  const fake = await setup({ generateText: async () => ({ text: 'LEVEL: low' }) });
  await fake.fire('prompt', promptEvent(sessionID, 'max effort: fix it'));
  // The status reads settings from storage; a hanging store must not hold up the request.
  fake.ctx.storage.get = () => new Promise(() => {});
  const sent = await Promise.race([
    fake.fire('context', contextEvent(sessionID)).then((event) => event.options.effort),
    new Promise((resolve) => setTimeout(() => resolve('held'), 100)),
  ]);
  expect(sent).toBe('max');
});
