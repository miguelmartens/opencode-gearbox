import { test } from 'node:test';
import assert from 'node:assert/strict';
import { makeFakeCtx } from '../fake-ctx.ts';
import { getState, resetState } from '../../src/server/state.ts';
import { loadSettings } from '../../src/server/settings-store.ts';
import { logOnce, toast } from '../../src/server/notify.ts';
import { DEFAULT_SETTINGS } from '../../src/core/types.ts';

test('getState creates fresh state and resetState clears it', () => {
  const state = getState('ses_a');
  assert.equal(state.lastLevel, null);
  assert.equal(state.userTurn, 0);
  state.userTurn = 3;
  assert.equal(getState('ses_a').userTurn, 3);
  resetState('ses_a');
  assert.equal(getState('ses_a').userTurn, 0);
});

test('fake ctx records hooks and fires them in order', async () => {
  const fake = makeFakeCtx();
  const seen: string[] = [];
  await fake.ctx.session.hook('prompt', () => {
    seen.push('a');
  });
  await fake.ctx.session.hook('prompt', () => {
    seen.push('b');
  });
  await fake.fire('prompt', {});
  assert.deepEqual(seen, ['a', 'b']);
});

test('fake ctx follows runtime shapes from docs/api-probe.md', async () => {
  const fake = makeFakeCtx({ models: [{ id: 'm' }], agents: [{ id: 'title', model: undefined }] });
  assert.deepEqual((await fake.ctx.model.list()).data, [{ id: 'm' }]);
  assert.equal((await fake.ctx.agent.get({ agentID: 'title' })).data.id, 'title');
  await assert.rejects(fake.ctx.agent.get({ agentID: 'nope' }), /Agent not found: nope/);
});

test('fake ctx feeds bus events to matching subscribers', async () => {
  const fake = makeFakeCtx();
  const controller = new AbortController();
  const iterator = fake.ctx.event
    .subscribe({ types: ['session.step.ended'], signal: controller.signal })
    [Symbol.asyncIterator]();
  fake.publish({ type: 'session.created', data: {} });
  fake.publish({ type: 'session.step.ended', data: { cost: 1 } });
  const next = await iterator.next();
  assert.deepEqual(next.value, { type: 'session.step.ended', data: { cost: 1 } });
  controller.abort();
  assert.equal((await iterator.next()).done, true);
});

test('notify toasts reach the fake ctx', async () => {
  const fake = makeFakeCtx();
  await toast({ sessionID: 'ses_a', message: 'hi', variant: 'info' });
  assert.deepEqual(fake.toasts, [{ sessionID: 'ses_a', message: 'hi', variant: 'info' }]);
  logOnce('ses_a', 'test', new Error('x'));
});

test('loadSettings returns the defaults', async () => {
  const fake = makeFakeCtx();
  assert.deepEqual(await loadSettings(fake.ctx), DEFAULT_SETTINGS);
});
