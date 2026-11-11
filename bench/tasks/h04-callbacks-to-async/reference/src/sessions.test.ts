import { expect, test } from 'bun:test';
import { createSession, endSession, resolveSession } from './sessions.ts';
import { MemoryStore } from './store.ts';
import type { StoreOptions } from './store.ts';
import { createUser } from './users.ts';

async function storeWithUser(options?: StoreOptions) {
  const store = new MemoryStore(options);
  await createUser(store, { id: 'u1', email: 'a@b.c', name: 'Ana' }, 0);
  return store;
}

test('a session resolves to its user until it expires', async () => {
  const store = await storeWithUser();
  const session = await createSession(store, 'u1', 't1', 1000, 500);
  expect(session).toEqual({ token: 't1', userId: 'u1', expiresAt: 1500 });
  expect((await resolveSession(store, 't1', 1499))?.id).toBe('u1');
  expect(await resolveSession(store, 't1', 1500)).toBeUndefined();
});

test('sessions need a known user', async () => {
  await expect(createSession(new MemoryStore(), 'ghost', 't', 0, 1)).rejects.toThrow(
    'unknown user',
  );
});

test('a failing session write rejects createSession', async () => {
  const boom = new Error('write failed');
  const store = await storeWithUser({
    fail: (op, key) => (op === 'set' && key.startsWith('session:') ? boom : undefined),
  });
  await expect(createSession(store, 'u1', 't1', 0, 1000)).rejects.toBe(boom);
});

test('ending a session', async () => {
  const store = await storeWithUser();
  await createSession(store, 'u1', 't1', 0, 1000);
  expect(await endSession(store, 't1')).toBe(true);
  expect(await endSession(store, 't1')).toBe(false);
});
