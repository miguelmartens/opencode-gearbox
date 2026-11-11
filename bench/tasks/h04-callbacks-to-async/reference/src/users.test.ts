import { expect, test } from 'bun:test';
import { MemoryStore } from './store.ts';
import { createUser, getUser, renameUser } from './users.ts';

const ana = { id: 'u1', email: 'Ana@Example.com', name: 'Ana' };

test('creates and reads a user', async () => {
  const store = new MemoryStore();
  const user = await createUser(store, ana, 1000);
  expect(user).toEqual({ id: 'u1', email: 'ana@example.com', name: 'Ana', createdAt: 1000 });
  expect(await getUser(store, 'u1')).toEqual(user);
  expect(await getUser(store, 'nobody')).toBeUndefined();
});

test('rejects duplicates and bad emails', async () => {
  const store = new MemoryStore();
  await createUser(store, ana, 1);
  await expect(createUser(store, ana, 2)).rejects.toThrow('already exists');
  await expect(createUser(store, { id: 'u2', email: 'nope', name: 'X' }, 1)).rejects.toThrow(
    'invalid email',
  );
});

test('renames a user', async () => {
  const store = new MemoryStore();
  await createUser(store, ana, 1);
  expect((await renameUser(store, 'u1', '  Anna ')).name).toBe('Anna');
  await expect(renameUser(store, 'u9', 'X')).rejects.toThrow('no user u9');
});

test('store failures reject', async () => {
  const boom = new Error('disk full');
  const store = new MemoryStore({ fail: (op) => (op === 'set' ? boom : undefined) });
  await expect(createUser(store, ana, 1)).rejects.toBe(boom);
});
