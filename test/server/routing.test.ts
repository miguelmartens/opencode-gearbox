import { test } from 'node:test';
import assert from 'node:assert/strict';
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
  assert.ok(getState(sessionID).pending, 'judge started');
  judge.open('LEVEL: high\nWHY: multi-file refactor');
  const event = await fake.fire('context', contextEvent(sessionID));
  assert.equal(event.options.effort, 'high');
  assert.deepEqual(event.options.thinking, { type: 'adaptive' });
  assert.equal(event.options.maxTokens, 32000);
  assert.equal(getState(sessionID).lastLevel, 'high');
  assert.equal(getState(sessionID).lastDecision?.source, 'judge');
  assert.equal(getState(sessionID).lastDecision?.reason, 'multi-file refactor');
  assert.equal(getState(sessionID).lastRequestAt, null, 'stamped from session.step.ended only');
  const status = fake.events.filter((e) => e.name === 'status').at(-1)?.payload as any;
  assert.equal(status.level, 'high');
  assert.equal(status.paused, null);
});

test('the turn decision applies on every context step', async () => {
  const sessionID = newSession();
  const fake = await setup({ generateText: async () => ({ text: 'LEVEL: xhigh' }) });
  await fake.fire('prompt', promptEvent(sessionID, 'Redesign the storage layer'));
  const first = await fake.fire('context', contextEvent(sessionID));
  const second = await fake.fire('context', contextEvent(sessionID));
  assert.equal(first.options.effort, 'xhigh');
  assert.equal(second.options.effort, 'xhigh');
  assert.equal(fake.callsTo('generate.text').length, 1);
});

test('follow-up reuses the last level without a judge call', async () => {
  const sessionID = newSession();
  const fake = await setup({ generateText: async () => ({ text: 'LEVEL: xhigh' }) });
  await fake.fire('prompt', promptEvent(sessionID, 'Debug this race condition'));
  await fake.fire('context', contextEvent(sessionID));
  await fake.fire('prompt', promptEvent(sessionID, 'ok'));
  const event = await fake.fire('context', contextEvent(sessionID));
  assert.equal(event.options.effort, 'xhigh');
  assert.equal(getState(sessionID).lastDecision?.source, 'followup');
  assert.equal(fake.callsTo('generate.text').length, 1);
  assert.equal(getState(sessionID).userTurn, 2);
});

test('named level skips the judge', async () => {
  const sessionID = newSession();
  const fake = await setup({ generateText: async () => ({ text: 'LEVEL: max' }) });
  await fake.fire('prompt', promptEvent(sessionID, 'low effort: fix the typo'));
  const event = await fake.fire('context', contextEvent(sessionID));
  assert.equal(event.options.effort, 'low');
  assert.equal(getState(sessionID).lastDecision?.source, 'named');
  assert.equal(fake.callsTo('generate.text').length, 0);
});

test('settings shape the level: bias and ceiling', async () => {
  const sessionID = newSession();
  const fake = await setup({
    settings: { bias: 1, ceiling: 'xhigh' },
    generateText: async () => ({ text: 'LEVEL: high' }),
  });
  await fake.fire('prompt', promptEvent(sessionID, 'Refactor the auth module'));
  const event = await fake.fire('context', contextEvent(sessionID));
  assert.equal(event.options.effort, 'xhigh');
  assert.equal(getState(sessionID).lastLevel, 'high', 'raw level kept for follow-ups');
  await fake.fire('prompt', promptEvent(sessionID, 'continue'));
  const next = await fake.fire('context', contextEvent(sessionID));
  assert.equal(next.options.effort, 'xhigh', 'bias is not applied twice');
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
  assert.ok(Date.now() - start <= 150, `took ${Date.now() - start} ms`);
  assert.equal(event.options.effort, 'medium');
  assert.equal(getState(sessionID).lastDecision?.source, 'fallback');
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
  assert.equal(thrown.options.effort, 'high');
  assert.equal(getState(sessionID).lastDecision?.source, 'fallback');

  answer = async () => ({ text: 'banana' });
  await fake.fire('prompt', promptEvent(sessionID, 'And add tests for it'));
  const garbage = await fake.fire('context', contextEvent(sessionID));
  assert.equal(garbage.options.effort, 'high');
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
  assert.deepEqual(event.options, { maxTokens: 32000 });
  assert.deepEqual(event.model, { ...OPUS, variant: 'default' });
});

test('manual variant pauses auto with one toast until auto is turned back on', async () => {
  const sessionID = newSession();
  const fake = await setup({
    sessions: { [sessionID]: { id: sessionID, model: { ...OPUS, variant: 'high' } } },
    generateText: async () => ({ text: 'LEVEL: low' }),
  });
  await fake.fire('prompt', promptEvent(sessionID, 'Refactor the auth module'));
  assert.equal(fake.callsTo('generate.text').length, 0, 'no judge while paused');
  const first = await fake.fire('context', contextEvent(sessionID, { ...OPUS, variant: 'high' }));
  const second = await fake.fire('context', contextEvent(sessionID, { ...OPUS, variant: 'high' }));
  assert.deepEqual(first.options, { maxTokens: 32000 });
  assert.deepEqual(second.options, { maxTokens: 32000 });
  assert.deepEqual(first.model, { ...OPUS, variant: 'high' });
  assert.equal(getState(sessionID).autoPaused, 'manual variant');
  assert.equal(fake.toasts.length, 1);
  assert.match(fake.toasts[0].message, /auto on/);

  // `/gearbox auto on` clears autoPaused (Task 8); the same variant no longer pauses.
  getState(sessionID).autoPaused = null;
  await fake.fire('prompt', promptEvent(sessionID, 'use low effort and rename it'));
  const resumed = await fake.fire('context', contextEvent(sessionID, { ...OPUS, variant: 'high' }));
  assert.equal(resumed.options.effort, 'low');
  assert.equal(fake.toasts.length, 1);
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
  assert.equal(fake.callsTo('session.switchModel').length, 0);
  const event = await fake.fire('context', contextEvent(sessionID, { ...OPUS, variant: 'medium' }));
  assert.equal(event.options.effort, 'low', 'effort applied, subagent variant is not manual');
  assert.deepEqual(event.model, { ...OPUS, variant: 'medium' });
  assert.equal(getState(sessionID).isSubagent, true);
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
  assert.equal(switches.length, 1);
  assert.deepEqual(switches[0].input, {
    sessionID,
    model: { providerID: 'anthropic', id: 'claude-haiku-5-5', variant: 'low' },
  });
  const judged = fake.callsTo('generate.text')[0].input as { prompt: string };
  assert.ok(!judged.prompt.includes('You are a subagent'), 'prefix stripped');
  assert.match(judged.prompt, /Find the config loader/);
  assert.match(judged.prompt, /subagent/);
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
  assert.equal(fake.callsTo('session.switchModel').length, 0);
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
  assert.deepEqual(resolve.model, OPUS);
  assert.deepEqual(event.model, { ...OPUS, variant: 'default' });
  assert.equal(fake.callsTo('session.switchModel').length, 0);
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
  assert.deepEqual(fresh.model, { providerID: 'anthropic', id: 'claude-haiku-5-5' });

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
  assert.deepEqual(warm.model, OPUS);
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
  assert.deepEqual(event.model, OPUS);
});

test('a target without effort variants gets no variant and shows paused status', async () => {
  const sessionID = newSession();
  const fake = await setup({ generateText: async () => ({ text: 'LEVEL: high' }) });
  await fake.fire('prompt', promptEvent(sessionID, 'Refactor the auth module'));
  const ref = { providerID: 'local', id: 'local-coder', variant: 'default' };
  const event = await fake.fire('context', contextEvent(sessionID, ref));
  assert.deepEqual(event.options, { maxTokens: 32000 });
  assert.deepEqual(event.model, ref);
  const status = fake.events.filter((e) => e.name === 'status').at(-1)?.payload as any;
  assert.equal(status.paused, 'no effort control');
  assert.equal(getState(sessionID).autoPaused, null, 'not a sticky pause');
});

test('auto off or a model outside effortModels changes nothing and skips the judge', async () => {
  for (const settings of [{ auto: false }, { effortModels: '^gpt-' }]) {
    const sessionID = newSession();
    const fake = await setup({ settings, generateText: async () => ({ text: 'LEVEL: max' }) });
    await fake.fire('prompt', promptEvent(sessionID, 'Refactor the auth module'));
    const event = await fake.fire('context', contextEvent(sessionID));
    assert.deepEqual(event.options, { maxTokens: 32000 });
    assert.equal(fake.callsTo('generate.text').length, 0);
  }
});

const tick = () => new Promise((resolve) => setTimeout(resolve, 10));

test('lastRequestAt is stamped from session.step.ended', async () => {
  const sessionID = newSession();
  const fake = await setup({ generateText: async () => ({ text: 'LEVEL: low' }) });
  await fake.fire('prompt', promptEvent(sessionID, 'What does this function do?'));
  await fake.fire('context', contextEvent(sessionID));
  assert.equal(getState(sessionID).lastRequestAt, null);
  fake.publish({
    type: 'session.step.ended',
    data: { sessionID, tokens: { input: 10, output: 1, cache: { read: 0, write: 0 } } },
  });
  await tick();
  assert.ok(getState(sessionID).lastRequestAt);
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
  assert.deepEqual(event.model, OPUS);
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
  assert.deepEqual(event.model, OPUS);
});

test('an invalid effortModels pattern is logged once and fails open', async (t) => {
  const errors = t.mock.method(console, 'error', () => {});
  const sessionID = newSession();
  const fake = await setup({
    settings: { effortModels: '(' },
    generateText: async () => ({ text: 'LEVEL: high' }),
  });
  await fake.fire('prompt', promptEvent(sessionID, 'Refactor the auth module'));
  const first = await fake.fire('context', contextEvent(sessionID));
  await fake.fire('context', contextEvent(sessionID));
  assert.equal(first.options.effort, 'high');
  const logged = errors.mock.calls.filter((call) => /effortModels/.test(String(call.arguments[0])));
  assert.equal(logged.length, 1);
});

test('a target without effort variants stores the effort pause in state', async () => {
  const sessionID = newSession();
  const fake = await setup({ generateText: async () => ({ text: 'LEVEL: high' }) });
  await fake.fire('prompt', promptEvent(sessionID, 'Refactor the auth module'));
  await fake.fire('context', contextEvent(sessionID, { providerID: 'local', id: 'local-coder' }));
  assert.equal(getState(sessionID).effortPaused, 'no effort control');
  await fake.fire('prompt', promptEvent(sessionID, 'ok'));
  await fake.fire('context', contextEvent(sessionID));
  assert.equal(getState(sessionID).effortPaused, null);
});

test('the raw judge answer is kept for /gearbox debug', async () => {
  const sessionID = newSession();
  const fake = await setup({ generateText: async () => ({ text: 'banana' }) });
  await fake.fire('prompt', promptEvent(sessionID, 'Refactor the auth module'));
  await fake.fire('context', contextEvent(sessionID));
  assert.equal(getState(sessionID).judgeAnswer, 'banana');
});

test('model.list is read once per step across judge, routing and status', async () => {
  const sessionID = newSession();
  const fake = await setup({ generateText: async () => ({ text: 'LEVEL: high' }) });
  await fake.fire('prompt', promptEvent(sessionID, 'Refactor the auth module'));
  await fake.fire('context', contextEvent(sessionID));
  await fake.fire('context', contextEvent(sessionID));
  assert.equal(fake.callsTo('model.list').length, 1);
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
  assert.ok(Date.now() - start <= 150, `took ${Date.now() - start} ms`);
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
  assert.equal(fake.callsTo('session.switchModel').length, 0);
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
  assert.equal(fake.callsTo('session.switchModel').length, 0);
  const event = await fake.fire('context', contextEvent(sessionID, ref));
  assert.equal(event.options.effort, 'low');
});

test('a re-prompted subagent climbs back up the ladder of its first model', async () => {
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
  // The switch persists on the session.
  sessions[sessionID].model = { providerID: 'anthropic', id: 'claude-haiku-5-5', variant: 'low' };
  await fake.fire('prompt', promptEvent(sessionID, 'max effort: now redesign the module'));
  const switches = fake.callsTo('session.switchModel');
  assert.equal(switches.length, 2);
  assert.deepEqual((switches[1].input as any).model, { ...OPUS, variant: 'max' });
});

test('subagent without an agent on its Session.Info keeps its model', async () => {
  const sessionID = newSession();
  const fake = await setup({
    sessions: { [sessionID]: { id: sessionID, parentID: 'ses_root', model: OPUS } },
    generateText: async () => ({ text: 'LEVEL: low' }),
  });
  await fake.fire('prompt', promptEvent(sessionID, `${SUBAGENT_PREFIX}Find the config loader`));
  assert.equal(fake.callsTo('session.switchModel').length, 0);
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
  assert.equal(admitted, true);
  assert.equal(getState(sessionID).autoPaused, 'manual variant');
});
