import { expect, test } from 'bun:test';
import { makeFakeCtx } from '../fake-ctx.ts';
import { getState, resetState } from '../../src/server/state.ts';
import { loadSettings } from '../../src/server/settings-store.ts';
import { logOnce, toast } from '../../src/server/notify.ts';
import { DEFAULT_SETTINGS } from '../../src/core/types.ts';

test('getState creates fresh state and resetState clears it', () => {
  const state = getState('ses_a');
  expect(state.lastLevel).toBe(null);
  expect(state.userTurn).toBe(0);
  state.userTurn = 3;
  expect(getState('ses_a').userTurn).toBe(3);
  resetState('ses_a');
  expect(getState('ses_a').userTurn).toBe(0);
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
  expect(seen).toStrictEqual(['a', 'b']);
});

test('fake ctx follows runtime shapes from docs/api-probe.md', async () => {
  const fake = makeFakeCtx({ models: [{ id: 'm' }], agents: [{ id: 'title', model: undefined }] });
  expect((await fake.ctx.model.list()).data).toStrictEqual([{ id: 'm' }]);
  expect((await fake.ctx.agent.get({ agentID: 'title' })).data.id).toBe('title');
  await expect(fake.ctx.agent.get({ agentID: 'nope' })).rejects.toThrow(/Agent not found: nope/);
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
  expect(next.value).toStrictEqual({ type: 'session.step.ended', data: { cost: 1 } });
  controller.abort();
  expect((await iterator.next()).done).toBe(true);
});

test('notify toasts reach the fake ctx', async () => {
  const fake = makeFakeCtx();
  await toast(fake.ctx, { sessionID: 'ses_a', message: 'hi', variant: 'info' });
  expect(fake.toasts).toStrictEqual([{ sessionID: 'ses_a', message: 'hi', variant: 'info' }]);
  logOnce('ses_a', 'test', new Error('x'));
});

test('loadSettings returns the defaults', async () => {
  const fake = makeFakeCtx();
  expect(await loadSettings(fake.ctx)).toStrictEqual(DEFAULT_SETTINGS);
});
