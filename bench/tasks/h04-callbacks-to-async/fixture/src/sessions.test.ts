import { expect, test } from 'bun:test';
import { createSession, endSession, resolveSession } from './sessions.ts';
import { MemoryStore } from './store.ts';
import type { Callback } from './store.ts';
import { createUser } from './users.ts';

function call<T>(fn: (cb: Callback<T>) => void): Promise<T> {
  return new Promise((resolve, reject) =>
    fn((err, value) => (err ? reject(err) : resolve(value!))),
  );
}

async function storeWithUser() {
  const store = new MemoryStore();
  await call((cb) => createUser(store, { id: 'u1', email: 'a@b.c', name: 'Ana' }, 0, cb));
  return store;
}

test('a session resolves to its user until it expires', async () => {
  const store = await storeWithUser();
  const session = await call((cb) => createSession(store, 'u1', 't1', 1000, 500, cb));
  expect(session).toEqual({ token: 't1', userId: 'u1', expiresAt: 1500 });
  const user = await call<{ id: string } | undefined>((cb) =>
    resolveSession(store, 't1', 1499, cb),
  );
  expect(user?.id).toBe('u1');
  expect(await call((cb) => resolveSession(store, 't1', 1500, cb))).toBeUndefined();
});

test('sessions need a known user', async () => {
  const store = new MemoryStore();
  await expect(call((cb) => createSession(store, 'ghost', 't', 0, 1, cb))).rejects.toThrow(
    'unknown user',
  );
});

test('ending a session', async () => {
  const store = await storeWithUser();
  await call((cb) => createSession(store, 'u1', 't1', 0, 1000, cb));
  expect(await call((cb) => endSession(store, 't1', cb))).toBe(true);
  expect(await call((cb) => endSession(store, 't1', cb))).toBe(false);
});
