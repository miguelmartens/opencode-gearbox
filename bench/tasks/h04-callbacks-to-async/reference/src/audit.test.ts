import { expect, test } from 'bun:test';
import { history, historyFor, record } from './audit.ts';
import { MemoryStore } from './store.ts';

test('records entries in order', async () => {
  const store = new MemoryStore();
  const first = await record(store, 'ana', 'login', 10);
  await record(store, 'ben', 'login', 20);
  await record(store, 'ana', 'logout', 30);
  expect(first).toEqual({ seq: 1, actor: 'ana', action: 'login', at: 10 });
  expect((await history(store)).map((e) => e.seq)).toEqual([1, 2, 3]);
  expect((await historyFor(store, 'ana')).map((e) => e.action)).toEqual(['login', 'logout']);
});

test('empty history', async () => {
  expect(await history(new MemoryStore())).toEqual([]);
});

test('a failed entry write does not use up a sequence number', async () => {
  let failNext = true;
  const store = new MemoryStore({
    fail: (op, key) => {
      if (op !== 'set' || !key.startsWith('audit:entry:') || !failNext) return undefined;
      failNext = false;
      return new Error('write failed');
    },
  });
  await expect(record(store, 'ana', 'login', 1)).rejects.toThrow('write failed');
  expect((await record(store, 'ana', 'login', 2)).seq).toBe(1);
});
