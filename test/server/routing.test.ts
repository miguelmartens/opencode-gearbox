import { expect, spyOn, test } from 'bun:test';
import { makeFakeCtx } from '../fake-ctx.ts';
import type { FakeCtxOptions } from '../fake-ctx.ts';
import { registerRouting } from '../../src/server/routing.ts';
import { getState } from '../../src/server/state.ts';
import { DEFAULT_SETTINGS, LEVELS } from '../../src/core/types.ts';
import type { Settings } from '../../src/core/types.ts';

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

test('subagent model switching off keeps the model', async () => {
  const sessionID = newSession();
  const fake = await setup({
    settings: { modelSwitch: { main: false, subagents: false, minSavingRatio: 0.2 } },
    sessions: {
      [sessionID]: { id: sessionID, parentID: 'ses_root', agent: 'general', model: OPUS },
    },
    agents: [{ id: 'general' }],
    generateText: async () => ({ text: 'LEVEL: low' }),
  });
  await fake.fire('prompt', promptEvent(sessionID, `${SUBAGENT_PREFIX}Find the config loader`));
  expect(fake.callsTo('session.switchModel').length).toBe(0);
});

test('main chat never switches the model when modelSwitch.main is false', async () => {
  const sessionID = newSession();
  const fake = await setup({ generateText: async () => ({ text: 'LEVEL: low' }) });
  await fake.fire('prompt', promptEvent(sessionID, 'What does this function do?'));
  const resolve = await fake.fire('experimental.model.resolve', {
    sessionID,
    agent: 'build',
    kind: 'primary',
    model: { ...OPUS },
  });
  const event = await fake.fire('context', contextEvent(sessionID));
  expect(resolve.model).toStrictEqual(OPUS);
  expect(event.model).toStrictEqual({ ...OPUS, variant: 'default' });
  expect(fake.callsTo('session.switchModel').length).toBe(0);
});

test('main chat switches through resolve only when shouldSwitch says so', async () => {
  const sessionID = newSession();
  const fake = await setup({
    settings: { modelSwitch: { main: true, subagents: true, minSavingRatio: 0.2 } },
    generateText: async () => ({ text: 'LEVEL: low' }),
  });
  await fake.fire('prompt', promptEvent(sessionID, 'What does this function do?'));
  const fresh = await fake.fire('experimental.model.resolve', {
    sessionID,
    agent: 'build',
    kind: 'primary',
    model: { ...OPUS },
  });
  expect(fresh.model).toStrictEqual({ providerID: 'anthropic', id: 'claude-haiku-5-5' });

  // A warm cache with a big context makes the switch too expensive.
  await fake.fire('context', contextEvent(sessionID));
  fake.publish({
    type: 'session.step.ended',
    data: { sessionID, tokens: { input: 1000, output: 10, cache: { read: 150_000, write: 0 } } },
  });
  await new Promise((resolve) => setImmediate(resolve));
  await fake.fire('prompt', promptEvent(sessionID, 'use low effort: and the other one?'));
  const warm = await fake.fire('experimental.model.resolve', {
    sessionID,
    agent: 'build',
    kind: 'primary',
    model: { ...OPUS },
  });
  expect(warm.model).toStrictEqual(OPUS);
});

test('resolve leaves title requests untouched', async () => {
  const sessionID = newSession();
  const fake = await setup({
    settings: { modelSwitch: { main: true, subagents: true, minSavingRatio: 0.2 } },
    generateText: async () => ({ text: 'LEVEL: low' }),
  });
  await fake.fire('prompt', promptEvent(sessionID, 'What does this function do?'));
  const event = await fake.fire('experimental.model.resolve', {
    sessionID,
    agent: 'title',
    kind: 'title',
    model: { ...OPUS },
  });
  expect(event.model).toStrictEqual(OPUS);
});

test('a target without effort variants gets no variant and shows paused status', async () => {
  const sessionID = newSession();
  const fake = await setup({ generateText: async () => ({ text: 'LEVEL: high' }) });
  await fake.fire('prompt', promptEvent(sessionID, 'Refactor the auth module'));
  const ref = { providerID: 'local', id: 'local-coder', variant: 'default' };
  const event = await fake.fire('context', contextEvent(sessionID, ref));
  expect(event.options).toStrictEqual({ maxTokens: 32000 });
  expect(event.model).toStrictEqual(ref);
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

test('resolve never switches the model of an agent with an explicit model', async () => {
  const sessionID = newSession();
  const fake = await setup({
    settings: { modelSwitch: { main: true, subagents: true, minSavingRatio: 0.2 } },
    agents: [{ id: 'build' }, { id: 'pinned', model: OPUS }],
    generateText: async () => ({ text: 'LEVEL: low' }),
  });
  await fake.fire('prompt', promptEvent(sessionID, 'What does this function do?'));
  const event = await fake.fire('experimental.model.resolve', {
    sessionID,
    agent: 'pinned',
    kind: 'primary',
    model: { ...OPUS },
  });
  expect(event.model).toStrictEqual(OPUS);
});

test('resolve treats an unknown agent as explicit and keeps the model', async () => {
  const sessionID = newSession();
  const fake = await setup({
    settings: { modelSwitch: { main: true, subagents: true, minSavingRatio: 0.2 } },
    generateText: async () => ({ text: 'LEVEL: low' }),
  });
  await fake.fire('prompt', promptEvent(sessionID, 'What does this function do?'));
  const event = await fake.fire('experimental.model.resolve', {
    sessionID,
    agent: 'ghost',
    kind: 'primary',
    model: { ...OPUS },
  });
  expect(event.model).toStrictEqual(OPUS);
});

test('an invalid effortModels pattern is logged once and fails open', async () => {
  const errors = spyOn(console, 'error').mockImplementation(() => {});
  const sessionID = newSession();
  const fake = await setup({
    settings: { effortModels: '(' },
    generateText: async () => ({ text: 'LEVEL: high' }),
  });
  await fake.fire('prompt', promptEvent(sessionID, 'Refactor the auth module'));
  const first = await fake.fire('context', contextEvent(sessionID));
  await fake.fire('context', contextEvent(sessionID));
  expect(first.options.effort).toBe('high');
  const logged = errors.mock.calls.filter((call) => /effortModels/.test(String(call[0])));
  expect(logged.length).toBe(1);
  errors.mockRestore();
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

test('resolve decides the main-chat model once per turn', async () => {
  const sessionID = newSession();
  const fake = await setup({
    settings: { modelSwitch: { main: true, subagents: true, minSavingRatio: 0.2 } },
    generateText: async () => ({ text: 'LEVEL: low' }),
  });
  const resolve = () =>
    fake.fire('experimental.model.resolve', {
      sessionID,
      agent: 'build',
      kind: 'primary',
      model: { ...OPUS },
    });
  await fake.fire('prompt', promptEvent(sessionID, 'What does this function do?'));
  expect((await resolve()).model).toStrictEqual(HAIKU);
  // The context grows within the turn; the turn keeps its model.
  await request(fake, sessionID, HAIKU, 150_000);
  expect((await resolve()).model).toStrictEqual(HAIKU);
});

test('resolve counts the cache warm only for the model that holds it', async () => {
  const sessionID = newSession();
  const fake = await setup({
    settings: { modelSwitch: { main: true, subagents: true, minSavingRatio: 0.2 } },
    generateText: async () => ({ text: 'LEVEL: low' }),
  });
  // The last request ran on Haiku, so Opus has no warm cache to lose.
  await request(fake, sessionID, HAIKU, 150_000);
  await fake.fire('prompt', promptEvent(sessionID, 'What does this function do?'));
  const event = await fake.fire('experimental.model.resolve', {
    sessionID,
    agent: 'build',
    kind: 'primary',
    model: { ...OPUS },
  });
  expect(event.model).toStrictEqual(HAIKU);
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
