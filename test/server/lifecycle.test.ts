import { test } from 'node:test';
import assert from 'node:assert/strict';
import { makeFakeCtx } from '../fake-ctx.ts';
import { setup } from '../../src/server/index.ts';
import { lifecycleConfig, watchEvents } from '../../src/server/lifecycle.ts';

const wait = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

test('setup returns a cleanup that aborts every subscription and disposes the RPC registration', async () => {
  const signals: AbortSignal[] = [];
  let disposed = 0;
  const fake = makeFakeCtx();
  const subscribe = fake.ctx.event.subscribe;
  fake.ctx.event.subscribe = (options: { signal?: AbortSignal }) => {
    assert.ok(options.signal, 'every subscription gets a signal');
    signals.push(options.signal);
    return subscribe(options);
  };
  const register = fake.ctx.rpc.register;
  fake.ctx.rpc.register = async (...args: any[]) => {
    const registration = await register(...args);
    return { ...registration, dispose: async () => void disposed++ };
  };
  const cleanup = await setup(fake.ctx);
  assert.equal(typeof cleanup, 'function');
  assert.ok(signals.length > 0);
  await cleanup();
  assert.ok(signals.every((signal) => signal.aborted));
  assert.equal(disposed, 1);
});

test('setup survives a context without event.subscribe', async () => {
  const fake = makeFakeCtx({ overrides: { event: { subscribe: undefined } } });
  const cleanup = await setup(fake.ctx);
  await cleanup();
});

test('a stream that ends is re-subscribed and logged', async (t) => {
  const errors = t.mock.method(console, 'error', () => {});
  lifecycleConfig.resubscribeMs = 5;
  const fake = makeFakeCtx();
  const subscribe = fake.ctx.event.subscribe;
  let calls = 0;
  fake.ctx.event.subscribe = (options: any) => {
    calls += 1;
    if (calls === 1) return { async *[Symbol.asyncIterator]() {} };
    if (calls === 2)
      return {
        async *[Symbol.asyncIterator]() {
          throw new Error('stream broke');
        },
      };
    return subscribe(options);
  };
  const seen: unknown[] = [];
  const controller = new AbortController();
  watchEvents(fake.ctx, ['x'], (event) => void seen.push(event.data), 'test', controller.signal);
  await wait(40);
  assert.equal(calls, 3);
  fake.publish({ type: 'x', data: 1 });
  await wait(5);
  assert.deepEqual(seen, [1]);
  assert.ok(errors.mock.calls.length >= 1);
  controller.abort();
  await wait(20);
  assert.equal(calls, 3, 'no re-subscribe after abort');
});
