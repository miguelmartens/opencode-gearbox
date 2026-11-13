import { describe, expect, test } from 'bun:test';
import { join } from 'node:path';

const dir = process.env.WORK_DIR!;
const load = async () => {
  const { MemoryDb } = await import(join(dir, 'src', 'db.ts'));
  const { UserService } = await import(join(dir, 'src', 'users.ts'));
  return { MemoryDb, UserService };
};

const ada = () => ({ id: 'u1', name: 'Ada', email: 'Ada@Example.com' });
const bob = () => ({ id: 'u2', name: 'Bob', email: 'bob@example.com' });

/** A database whose next read of `method` waits until `release()`. */
function gated(db: any, method: string) {
  let release!: () => void;
  const gate = new Promise<void>((resolve) => (release = resolve));
  const original = db[method].bind(db);
  let armed = true;
  db[method] = async (...args: unknown[]) => {
    if (!armed) return original(...args);
    armed = false;
    const result = await original(...args);
    await gate;
    return result;
  };
  return () => release();
}

describe('UserService never serves stale data', () => {
  test('an email change frees the old address, in any case', async () => {
    const { MemoryDb, UserService } = await load();
    const users = new UserService(new MemoryDb());
    await users.createUser(ada());
    expect((await users.getUserByEmail('Ada@Example.com'))?.id).toBe('u1');
    expect((await users.getUserByEmail('ada@example.com'))?.id).toBe('u1');
    await users.updateUser('u1', { email: 'ada@new.example' });
    expect(await users.getUserByEmail('Ada@Example.com')).toBe(null);
    expect(await users.getUserByEmail('ada@example.com')).toBe(null);
    expect((await users.getUserByEmail('ADA@NEW.EXAMPLE'))?.id).toBe('u1');
  });

  test('a failed lookup does not hide a later sign-up', async () => {
    const { MemoryDb, UserService } = await load();
    const users = new UserService(new MemoryDb());
    expect(await users.getUserByEmail('bob@example.com')).toBe(null);
    expect(await users.getUser('u2')).toBe(null);
    await users.createUser(bob());
    expect((await users.getUserByEmail('bob@example.com'))?.id).toBe('u2');
    expect((await users.getUser('u2'))?.name).toBe('Bob');
  });

  test('a deleted user is gone by id, by email and from the list', async () => {
    const { MemoryDb, UserService } = await load();
    const users = new UserService(new MemoryDb());
    await users.createUser(ada());
    await users.createUser(bob());
    await users.getUser('u1');
    await users.getUserByEmail('ada@example.com');
    expect((await users.listUsers()).map((u: any) => u.id)).toEqual(['u1', 'u2']);
    await users.deleteUser('u1');
    expect(await users.getUser('u1')).toBe(null);
    expect(await users.getUserByEmail('ada@example.com')).toBe(null);
    expect((await users.listUsers()).map((u: any) => u.id)).toEqual(['u2']);
  });

  test('the list follows creates and renames', async () => {
    const { MemoryDb, UserService } = await load();
    const users = new UserService(new MemoryDb());
    expect(await users.listUsers()).toEqual([]);
    await users.createUser(ada());
    expect((await users.listUsers()).map((u: any) => u.name)).toEqual(['Ada']);
    await users.updateUser('u1', { name: 'Ada L.' });
    expect((await users.listUsers()).map((u: any) => u.name)).toEqual(['Ada L.']);
  });

  test('callers cannot change what others read', async () => {
    const { MemoryDb, UserService } = await load();
    const users = new UserService(new MemoryDb());
    const input = ada();
    await users.createUser(input);
    input.name = 'mutated input';
    (await users.getUser('u1')).name = 'mutated by id';
    (await users.getUserByEmail('ada@example.com')).name = 'mutated by email';
    const list = await users.listUsers();
    list[0].name = 'mutated in list';
    list.push(bob());
    const updated = await users.updateUser('u1', { email: 'ada@new.example' });
    updated.name = 'mutated update';
    expect((await users.getUser('u1'))?.name).toBe('Ada');
    expect((await users.getUserByEmail('ada@new.example'))?.name).toBe('Ada');
    expect(await users.listUsers()).toEqual([{ id: 'u1', name: 'Ada', email: 'ada@new.example' }]);
  });

  test('a read that overlaps a write is not cached', async () => {
    const { MemoryDb, UserService } = await load();
    const db = new MemoryDb();
    const users = new UserService(db);
    await users.createUser(ada());
    const release = gated(db, 'findById');
    const slow = users.getUser('u1');
    await users.updateUser('u1', { name: 'Ada L.' });
    release();
    await slow;
    expect((await users.getUser('u1'))?.name).toBe('Ada L.');

    const releaseList = gated(db, 'all');
    const slowList = users.listUsers();
    await users.createUser(bob());
    releaseList();
    await slowList;
    expect((await users.listUsers()).map((u: any) => u.id)).toEqual(['u1', 'u2']);

    const releaseEmail = gated(db, 'findByEmail');
    const slowEmail = users.getUserByEmail('carol@example.com');
    await users.createUser({ id: 'u3', name: 'Carol', email: 'carol@example.com' });
    releaseEmail();
    await slowEmail;
    expect((await users.getUserByEmail('carol@example.com'))?.id).toBe('u3');
  });

  test('repeated reads with no write in between hit the database once', async () => {
    const { MemoryDb, UserService } = await load();
    const db = new MemoryDb();
    const users = new UserService(db);
    await users.createUser(ada());
    await users.createUser(bob());
    const before = db.reads;
    for (let i = 0; i < 3; i++) {
      await users.getUser('u1');
      await users.getUser('missing');
      await users.getUserByEmail('bob@example.com');
      await users.getUserByEmail('nobody@example.com');
      await users.listUsers();
    }
    expect(db.reads - before).toBe(5);
  });
});
