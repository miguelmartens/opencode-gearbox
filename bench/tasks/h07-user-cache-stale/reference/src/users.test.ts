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

test('an email change frees the old address', async () => {
  const users = new UserService(new MemoryDb());
  await users.createUser(ada);
  await users.getUserByEmail('Ada@Example.com');
  await users.updateUser('u1', { email: 'ada@new.example' });
  expect(await users.getUserByEmail('ada@example.com')).toBe(null);
  expect(await users.getUserByEmail('Ada@Example.com')).toBe(null);
});

test('a failed lookup does not hide a later sign-up', async () => {
  const users = new UserService(new MemoryDb());
  expect(await users.getUserByEmail('ada@example.com')).toBe(null);
  await users.createUser(ada);
  expect((await users.getUserByEmail('ada@example.com'))?.id).toBe('u1');
});

test('the list follows creates and deletes', async () => {
  const users = new UserService(new MemoryDb());
  expect(await users.listUsers()).toEqual([]);
  await users.createUser(ada);
  expect((await users.listUsers()).map((u) => u.id)).toEqual(['u1']);
  await users.deleteUser('u1');
  expect(await users.listUsers()).toEqual([]);
});

test('returned objects are copies', async () => {
  const users = new UserService(new MemoryDb());
  await users.createUser(ada);
  (await users.getUser('u1'))!.name = 'changed';
  (await users.listUsers())[0]!.name = 'changed';
  expect((await users.getUser('u1'))?.name).toBe('Ada');
  expect((await users.listUsers())[0]?.name).toBe('Ada');
});
