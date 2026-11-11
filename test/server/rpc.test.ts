import { expect, test } from 'bun:test';
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
  expect(registrations.length).toBe(1);
  expect(registrations[0].definition).toBe(Gearbox);
  expect(Gearbox.id).toBe('gearbox');
  expect(Gearbox.events[STATUS_EVENT]).toBeTruthy();
  expect(Gearbox.events[TOAST_EVENT]).toBeTruthy();
  expect(typeof registrations[0].handlers.status).toBe('function');
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
  expect(s.sessionID).toBe('ses_rpc_state');
  expect(s.level).toBe('high');
  expect(s.judgeReason).toBe('multi-file change');
  expect(s.paused).toBe('manual variant');
  expect(s.auto).toBe(true);
  expect(s.model).toBe(null);
  expect(s.contextRatio).toBe(null);
  expect(s.cacheRemainingMs).toBe(null);
  expect(s.advice).toBe(null);
});

test('notify toasts go out through the RPC registration', async () => {
  const { fake, emitted } = setup();
  await registerRpc(fake.ctx);
  await toast({ sessionID: 'ses_t', message: 'Auto paused', variant: 'info' });
  expect(emitted).toStrictEqual([
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
  expect(s.model).toStrictEqual({ providerID: 'anthropic', id: 'claude-haiku-5-5' });
  expect(s.contextRatio).toBe(0.38);
  expect(s.cacheRemainingMs !== null && s.cacheRemainingMs > 3_590_000).toBeTruthy();
  expect(s.cacheRemainingMs <= 3_600_000).toBeTruthy();
  const sent = emitted.filter((e) => e.name === STATUS_EVENT);
  expect(sent.length).toBe(1);
  expect(sent[0].payload.sessionID).toBe('ses_rpc_steps');
  expect(sent[0].payload.contextRatio).toBe(0.38);
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
  expect(s.contextRatio).toBe(0.25);
  expect(s.cacheRemainingMs !== null && s.cacheRemainingMs > 290_000).toBeTruthy();
  expect(s.cacheRemainingMs <= 300_000).toBeTruthy();
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
  expect(sent.length).toBe(1);
  expect(sent[0].payload.paused).toBe('no effort control');
  expect(sent[0].payload.advice).toBe('swamped');
  expect(sent[0].payload.model).toStrictEqual({ providerID: 'anthropic', id: 'claude-haiku-5-5' });
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
  expect(last().paused).toBe('no effort control');

  fake.publish({
    type: 'session.step.ended',
    data: { sessionID, finish: 'stop', tokens: { input: 800, cache: { read: 0, write: 0 } } },
  });
  await new Promise((resolve) => setTimeout(resolve, 20));
  expect(last().advice).toBe('swamped');
  expect(last().paused).toBe('no effort control');

  await fake.fire('prompt', { sessionID, prompt: { text: 'continue' } });
  await fake.fire('context', { sessionID, agent: 'build', model: ref, messages: [], options: {} });
  expect(last().advice).toBe('swamped');
  expect(last().paused).toBe('no effort control');
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
  expect(s.level).toBe('medium');
  expect(s.contextRatio).toBe(null);
  expect(s.cacheRemainingMs !== null && s.cacheRemainingMs <= 300_000).toBeTruthy();
});

test('parseTtlMs reads OpenCode TTL strings', () => {
  expect(parseTtlMs('5m')).toBe(300_000);
  expect(parseTtlMs('1h')).toBe(3_600_000);
  expect(parseTtlMs('30s')).toBe(30_000);
  expect(parseTtlMs('500ms')).toBe(500);
  expect(parseTtlMs('1d')).toBe(86_400_000);
  expect(parseTtlMs('soon')).toBe(null);
  expect(parseTtlMs(undefined)).toBe(null);
});

test('session.deleted forgets the session state', async () => {
  resetState('ses_rpc_deleted');
  getState('ses_rpc_deleted').lastLevel = 'max';
  const { fake } = setup();
  await registerRpc(fake.ctx);
  fake.publish({ type: 'session.deleted', data: { sessionID: 'ses_rpc_deleted', info: {} } });
  await tick();
  await tick();
  expect(getState('ses_rpc_deleted').lastLevel).toBe(null);
});
