import { test } from 'node:test';
import assert from 'node:assert/strict';
import { makeFakeCtx } from '../fake-ctx.ts';
import { getCare, getState, resetState } from '../../src/server/state.ts';
import { toast } from '../../src/server/notify.ts';
import { statusChanged } from '../../src/server/status.ts';
import { registerRouting } from '../../src/server/routing.ts';
import { registerContextCare } from '../../src/server/care.ts';
import { parseTtlMs, registerRpc } from '../../src/server/rpc.ts';
import { Gearbox, STATUS_EVENT, TOAST_EVENT } from '../../src/rpc.ts';
import type { GearboxStatus } from '../../src/core/types.ts';

const tick = () => new Promise((resolve) => setImmediate(resolve));

const haiku = {
  id: 'claude-haiku-5-5',
  providerID: 'anthropic',
  settings: { cache: { ttl: '1h' } },
  variants: [],
  limit: { context: 200_000, output: 64_000 },
};

/** A fake ctx whose RPC registration records its own emits, separate from the fake's emitter. */
function setup(opts: Parameters<typeof makeFakeCtx>[0] = {}) {
  const emitted: Array<{ name: string; payload: any }> = [];
  const registrations: Array<{ definition: unknown; handlers: Record<string, any> }> = [];
  const rpc = Object.assign(() => ({}), {
    register: async (definition: unknown, handlers: Record<string, any>) => {
      registrations.push({ definition, handlers });
      return {
        dispose: async () => {},
        events: {
          emit: async (name: string, payload: unknown) => {
            emitted.push({ name, payload });
          },
        },
      };
    },
  });
  const fake = makeFakeCtx({ ...opts, overrides: { rpc, ...opts.overrides } });
  const status = (sessionID: string): Promise<GearboxStatus> =>
    registrations[0].handlers.status({ sessionID }, { signal: new AbortController().signal });
  return { fake, emitted, registrations, status };
}

test('registerRpc registers the Gearbox contract with a status method', async () => {
  const { fake, registrations } = setup();
  await registerRpc(fake.ctx);
  assert.equal(registrations.length, 1);
  assert.equal(registrations[0].definition, Gearbox);
  assert.equal(Gearbox.id, 'gearbox');
  assert.ok(Gearbox.events[STATUS_EVENT]);
  assert.ok(Gearbox.events[TOAST_EVENT]);
  assert.equal(typeof registrations[0].handlers.status, 'function');
});

test('status returns getState data for the session', async () => {
  resetState('ses_rpc_state');
  const state = getState('ses_rpc_state');
  state.lastLevel = 'high';
  state.lastDecision = { level: 'high', source: 'judge', reason: 'multi-file change' };
  state.autoPaused = 'manual variant';
  const { fake, status } = setup();
  await registerRpc(fake.ctx);
  const s = await status('ses_rpc_state');
  assert.equal(s.sessionID, 'ses_rpc_state');
  assert.equal(s.level, 'high');
  assert.equal(s.judgeReason, 'multi-file change');
  assert.equal(s.paused, 'manual variant');
  assert.equal(s.auto, true);
  assert.equal(s.model, null);
  assert.equal(s.contextRatio, null);
  assert.equal(s.cacheRemainingMs, null);
  assert.equal(s.advice, null);
});

test('notify toasts go out through the RPC registration', async () => {
  const { fake, emitted } = setup();
  await registerRpc(fake.ctx);
  await toast({ sessionID: 'ses_t', message: 'Auto paused', variant: 'info' });
  assert.deepEqual(emitted, [
    { name: TOAST_EVENT, payload: { sessionID: 'ses_t', message: 'Auto paused', variant: 'info' } },
  ]);
});

test('step events feed model, context ratio and cache into the status and emit it', async () => {
  resetState('ses_rpc_steps');
  const { fake, emitted, status } = setup({ models: [haiku] });
  await registerRpc(fake.ctx);
  fake.publish({
    type: 'session.step.started',
    data: {
      sessionID: 'ses_rpc_steps',
      model: { providerID: 'anthropic', id: 'claude-haiku-5-5', variant: 'default' },
    },
  });
  fake.publish({
    type: 'session.step.ended',
    data: {
      sessionID: 'ses_rpc_steps',
      tokens: { input: 10_000, output: 500, reasoning: 0, cache: { read: 60_000, write: 6_000 } },
    },
  });
  await tick();
  await tick();
  const s = await status('ses_rpc_steps');
  assert.deepEqual(s.model, { providerID: 'anthropic', id: 'claude-haiku-5-5' });
  assert.equal(s.contextRatio, 0.38);
  assert.ok(s.cacheRemainingMs !== null && s.cacheRemainingMs > 3_590_000);
  assert.ok(s.cacheRemainingMs <= 3_600_000);
  const sent = emitted.filter((e) => e.name === STATUS_EVENT);
  assert.equal(sent.length, 1);
  assert.equal(sent[0].payload.sessionID, 'ses_rpc_steps');
  assert.equal(sent[0].payload.contextRatio, 0.38);
});

test('cache defaults to 5 minutes and prefers limit.input', async () => {
  resetState('ses_rpc_default_ttl');
  const model = {
    id: 'gpt-6-luna',
    providerID: 'openai',
    limit: { context: 400_000, input: 100_000 },
  };
  const { fake, status } = setup({ models: [model] });
  await registerRpc(fake.ctx);
  fake.publish({
    type: 'session.step.started',
    data: { sessionID: 'ses_rpc_default_ttl', model: { providerID: 'openai', id: 'gpt-6-luna' } },
  });
  fake.publish({
    type: 'session.step.ended',
    data: { sessionID: 'ses_rpc_default_ttl', tokens: { input: 25_000, cache: { read: 0 } } },
  });
  await tick();
  await tick();
  const s = await status('ses_rpc_default_ttl');
  assert.equal(s.contextRatio, 0.25);
  assert.ok(s.cacheRemainingMs !== null && s.cacheRemainingMs > 290_000);
  assert.ok(s.cacheRemainingMs <= 300_000);
});

test('every status emit is built from the shared state, whatever the emitter', async () => {
  resetState('ses_rpc_sibling');
  getState('ses_rpc_sibling').lastLevel = 'low';
  getState('ses_rpc_sibling').effortPaused = 'no effort control';
  getCare('ses_rpc_sibling').advice = 'swamped';
  const { fake, emitted } = setup({ models: [haiku] });
  await registerRpc(fake.ctx);
  fake.publish({
    type: 'session.step.started',
    data: {
      sessionID: 'ses_rpc_sibling',
      model: { providerID: 'anthropic', id: 'claude-haiku-5-5' },
    },
  });
  await tick();
  await statusChanged(fake.ctx, 'ses_rpc_sibling');
  const sent = emitted.filter((e) => e.name === STATUS_EVENT);
  assert.equal(sent.length, 1);
  assert.equal(sent[0].payload.paused, 'no effort control');
  assert.equal(sent[0].payload.advice, 'swamped');
  assert.deepEqual(sent[0].payload.model, { providerID: 'anthropic', id: 'claude-haiku-5-5' });
});

test('no effort control survives a care emit; advice survives a routing emit', async () => {
  const sessionID = 'ses_rpc_merge';
  resetState(sessionID);
  const local = {
    id: 'local-coder',
    providerID: 'local',
    capabilities: { tools: true },
    variants: [],
    cost: [{ input: 0, output: 0 }],
    enabled: true,
    limit: { context: 1000 },
  };
  const ref = { providerID: 'local', id: 'local-coder' };
  const { fake, emitted } = setup({
    models: [local],
    sessions: { [sessionID]: { id: sessionID, model: ref } },
    generateText: async () => ({ text: 'NO' }),
  });
  await registerRouting(fake.ctx);
  await registerContextCare(fake.ctx);
  await registerRpc(fake.ctx);
  const last = () => emitted.filter((e) => e.name === STATUS_EVENT).at(-1)?.payload;

  await fake.fire('prompt', { sessionID, prompt: { text: 'ok' } });
  await fake.fire('context', { sessionID, agent: 'build', model: ref, messages: [], options: {} });
  assert.equal(last().paused, 'no effort control');

  fake.publish({
    type: 'session.step.ended',
    data: { sessionID, finish: 'stop', tokens: { input: 800, cache: { read: 0, write: 0 } } },
  });
  await new Promise((resolve) => setTimeout(resolve, 20));
  assert.equal(last().advice, 'swamped');
  assert.equal(last().paused, 'no effort control');

  await fake.fire('prompt', { sessionID, prompt: { text: 'continue' } });
  await fake.fire('context', { sessionID, agent: 'build', model: ref, messages: [], options: {} });
  assert.equal(last().advice, 'swamped');
  assert.equal(last().paused, 'no effort control');
});

test('status survives a failing model list', async () => {
  resetState('ses_rpc_fail');
  getState('ses_rpc_fail').lastLevel = 'medium';
  const { fake, status } = setup({
    overrides: {
      model: {
        list: async () => {
          throw new Error('boom');
        },
      },
    },
  });
  await registerRpc(fake.ctx);
  fake.publish({
    type: 'session.step.started',
    data: { sessionID: 'ses_rpc_fail', model: { providerID: 'anthropic', id: 'x' } },
  });
  fake.publish({
    type: 'session.step.ended',
    data: { sessionID: 'ses_rpc_fail', tokens: { input: 1, cache: { read: 0 } } },
  });
  await tick();
  await tick();
  const s = await status('ses_rpc_fail');
  assert.equal(s.level, 'medium');
  assert.equal(s.contextRatio, null);
  assert.ok(s.cacheRemainingMs !== null && s.cacheRemainingMs <= 300_000);
});

test('parseTtlMs reads OpenCode TTL strings', () => {
  assert.equal(parseTtlMs('5m'), 300_000);
  assert.equal(parseTtlMs('1h'), 3_600_000);
  assert.equal(parseTtlMs('30s'), 30_000);
  assert.equal(parseTtlMs('500ms'), 500);
  assert.equal(parseTtlMs('1d'), 86_400_000);
  assert.equal(parseTtlMs('soon'), null);
  assert.equal(parseTtlMs(undefined), null);
});

test('session.deleted forgets the session state', async () => {
  resetState('ses_rpc_deleted');
  getState('ses_rpc_deleted').lastLevel = 'max';
  const { fake } = setup();
  await registerRpc(fake.ctx);
  fake.publish({ type: 'session.deleted', data: { sessionID: 'ses_rpc_deleted', info: {} } });
  await tick();
  await tick();
  assert.equal(getState('ses_rpc_deleted').lastLevel, null);
});
