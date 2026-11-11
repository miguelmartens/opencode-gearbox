import { expect, test } from 'bun:test';
import { MemoryStore } from './store.ts';
import type { Callback } from './store.ts';
import { createUser, getUser, renameUser } from './users.ts';

// Turns a callback-style call into a promise for the assertions below.
function call<T>(fn: (cb: Callback<T>) => void): Promise<T> {
  return new Promise((resolve, reject) =>
    fn((err, value) => (err ? reject(err) : resolve(value!))),
  );
}

const ana = { id: 'u1', email: 'Ana@Example.com', name: 'Ana' };

test('creates and reads a user', async () => {
  const store = new MemoryStore();
  const user = await call((cb) => createUser(store, ana, 1000, cb));
  expect(user).toEqual({ id: 'u1', email: 'ana@example.com', name: 'Ana', createdAt: 1000 });
  expect(await call((cb) => getUser(store, 'u1', cb))).toEqual(user);
  expect(await call((cb) => getUser(store, 'nobody', cb))).toBeUndefined();
});

test('rejects duplicates and bad emails', async () => {
  const store = new MemoryStore();
  await call((cb) => createUser(store, ana, 1, cb));
  await expect(call((cb) => createUser(store, ana, 2, cb))).rejects.toThrow('already exists');
  await expect(
    call((cb) => createUser(store, { id: 'u2', email: 'nope', name: 'X' }, 1, cb)),
  ).rejects.toThrow('invalid email');
});

test('renames a user', async () => {
  const store = new MemoryStore();
  await call((cb) => createUser(store, ana, 1, cb));
  const renamed = await call<{ name: string }>((cb) => renameUser(store, 'u1', '  Anna ', cb));
  expect(renamed.name).toBe('Anna');
  await expect(call((cb) => renameUser(store, 'u9', 'X', cb))).rejects.toThrow('no user u9');
});
