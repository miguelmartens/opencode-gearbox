import { expect, test } from 'bun:test';
import { history, historyFor, record } from './audit.ts';
import type { AuditEntry } from './audit.ts';
import { MemoryStore } from './store.ts';
import type { Callback } from './store.ts';

function call<T>(fn: (cb: Callback<T>) => void): Promise<T> {
  return new Promise((resolve, reject) =>
    fn((err, value) => (err ? reject(err) : resolve(value!))),
  );
}

test('records entries in order', async () => {
  const store = new MemoryStore();
  const first = await call<AuditEntry>((cb) => record(store, 'ana', 'login', 10, cb));
  await call((cb) => record(store, 'ben', 'login', 20, cb));
  await call((cb) => record(store, 'ana', 'logout', 30, cb));
  expect(first).toEqual({ seq: 1, actor: 'ana', action: 'login', at: 10 });
  const all = await call<AuditEntry[]>((cb) => history(store, cb));
  expect(all.map((e) => e.seq)).toEqual([1, 2, 3]);
  const anas = await call<AuditEntry[]>((cb) => historyFor(store, 'ana', cb));
  expect(anas.map((e) => e.action)).toEqual(['login', 'logout']);
});

test('empty history', async () => {
  expect(await call((cb) => history(new MemoryStore(), cb))).toEqual([]);
});
