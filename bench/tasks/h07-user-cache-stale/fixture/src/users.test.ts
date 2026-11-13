import { expect, test } from 'bun:test';
import { MemoryDb } from './db.ts';
import { UserService } from './users.ts';

const ada = { id: 'u1', name: 'Ada', email: 'ada@example.com' };

test('reads come from the cache after the first one', async () => {
  const db = new MemoryDb();
  const users = new UserService(db);
  await users.createUser(ada);
  const before = db.reads;
  expect(await users.getUser('u1')).toEqual(ada);
  expect(await users.getUser('u1')).toEqual(ada);
  expect(db.reads - before).toBeLessThanOrEqual(1);
});

test('an update is visible by id', async () => {
  const users = new UserService(new MemoryDb());
  await users.createUser(ada);
  await users.updateUser('u1', { name: 'Ada L.' });
  expect((await users.getUser('u1'))?.name).toBe('Ada L.');
});

test('lookup by email', async () => {
  const users = new UserService(new MemoryDb());
  await users.createUser(ada);
  expect((await users.getUserByEmail('ada@example.com'))?.id).toBe('u1');
});
