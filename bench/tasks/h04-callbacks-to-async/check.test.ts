import { describe, expect, test } from 'bun:test';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

const dir = process.env.WORK_DIR!;
const load = (name: string) => import(join(dir, 'src', name));

async function newStore(fail?: (op: string, key: string) => Error | undefined) {
  const { MemoryStore } = await load('store.ts');
  return new MemoryStore(fail ? { fail } : {});
}

const T = 2000;

describe('MemoryStore', () => {
  test(
    'promise API',
    async () => {
      const store = await newStore();
      expect(store.get.length).toBe(1);
      expect(store.set.length).toBe(2);
      expect(store.delete.length).toBe(1);
      expect(store.keys.length).toBe(1);

      const pending = store.get('missing');
      expect(pending).toBeInstanceOf(Promise);
      expect(await pending).toBeUndefined();

      const value = { a: 1, nested: { b: [1, 2] } };
      expect(await store.set('k:1', value)).toBeUndefined();
      const read = await store.get('k:1');
      expect(read).toEqual(value);
      read.nested.b.push(3);
      value.a = 2;
      expect(await store.get('k:1')).toEqual({ a: 1, nested: { b: [1, 2] } });

      await store.set('k:0', 0);
      await store.set('other', 'x');
      expect(await store.keys('k:')).toEqual(['k:0', 'k:1']);
      expect(await store.get('k:0')).toBe(0);
      expect(await store.delete('k:0')).toBe(true);
      expect(await store.delete('k:0')).toBe(false);
      expect(await store.keys('k:')).toEqual(['k:1']);
    },
    T,
  );

  test(
    'failures are rejections with the injected error',
    async () => {
      const boom = new Error('backend down');
      const store = await newStore((op, key) => (key === 'bad' ? boom : undefined));
      for (const op of [
        () => store.get('bad'),
        () => store.set('bad', 1),
        () => store.delete('bad'),
        () => store.keys('bad'),
      ]) {
        const result = op();
        expect(result).toBeInstanceOf(Promise);
        await expect(result).rejects.toBe(boom);
      }
      expect(await store.get('good')).toBeUndefined();
    },
    T,
  );
});

describe('users', () => {
  test(
    'create, read, rename',
    async () => {
      const { createUser, getUser, renameUser } = await load('users.ts');
      const store = await newStore();
      const user = await createUser(store, { id: 'u1', email: 'Ana@X.io', name: 'Ana' }, 5);
      expect(user).toEqual({ id: 'u1', email: 'ana@x.io', name: 'Ana', createdAt: 5 });
      expect(await getUser(store, 'u1')).toEqual(user);
      expect(await getUser(store, 'u2')).toBeUndefined();
      expect(await renameUser(store, 'u1', ' Anna ')).toEqual({ ...user, name: 'Anna' });
      expect((await getUser(store, 'u1')).name).toBe('Anna');
    },
    T,
  );

  test(
    'validation errors are rejections',
    async () => {
      const { createUser, renameUser } = await load('users.ts');
      const store = await newStore();
      const bad = createUser(store, { id: 'u1', email: 'nope', name: 'X' }, 1);
      expect(bad).toBeInstanceOf(Promise);
      await expect(bad).rejects.toThrow('invalid email');
      await createUser(store, { id: 'u1', email: 'a@b.c', name: 'X' }, 1);
      await expect(createUser(store, { id: 'u1', email: 'z@b.c', name: 'Y' }, 2)).rejects.toThrow(
        'already exists',
      );
      await expect(renameUser(store, 'u1', '   ')).rejects.toThrow('name must not be empty');
      await expect(renameUser(store, 'nobody', 'X')).rejects.toThrow('no user nobody');
    },
    T,
  );

  test(
    'store errors propagate and nothing is written',
    async () => {
      const { createUser } = await load('users.ts');
      const readErr = new Error('read failed');
      const writes: string[] = [];
      const store = await newStore((op, key) => {
        if (op === 'set') writes.push(key);
        return op === 'get' ? readErr : undefined;
      });
      await expect(createUser(store, { id: 'u1', email: 'a@b.c', name: 'A' }, 1)).rejects.toBe(
        readErr,
      );
      expect(writes).toEqual([]);

      const writeErr = new Error('write failed');
      const store2 = await newStore((op) => (op === 'set' ? writeErr : undefined));
      await expect(createUser(store2, { id: 'u1', email: 'a@b.c', name: 'A' }, 1)).rejects.toBe(
        writeErr,
      );
    },
    T,
  );
});

describe('sessions', () => {
  async function setup(fail?: (op: string, key: string) => Error | undefined) {
    let armed = false;
    const store = await newStore((op, key) => (armed && fail ? fail(op, key) : undefined));
    const { createUser } = await load('users.ts');
    await createUser(store, { id: 'u1', email: 'a@b.c', name: 'Ana' }, 0);
    const sessions = await load('sessions.ts');
    return { store, sessions, arm: () => (armed = true) };
  }

  test(
    'lifecycle',
    async () => {
      const { store, sessions } = await setup();
      const session = await sessions.createSession(store, 'u1', 'tok', 100, 50);
      expect(session).toEqual({ token: 'tok', userId: 'u1', expiresAt: 150 });
      expect((await sessions.resolveSession(store, 'tok', 149)).id).toBe('u1');
      expect(await sessions.resolveSession(store, 'nope', 0)).toBeUndefined();
      expect(await sessions.resolveSession(store, 'tok', 150)).toBeUndefined();
      // The expired session was removed.
      expect(await sessions.endSession(store, 'tok')).toBe(false);
      await sessions.createSession(store, 'u1', 'tok2', 0, 10);
      expect(await sessions.endSession(store, 'tok2')).toBe(true);
      await expect(sessions.createSession(store, 'ghost', 't', 0, 1)).rejects.toThrow(
        'unknown user ghost',
      );
    },
    T,
  );

  test(
    'a failing session write rejects createSession',
    async () => {
      const boom = new Error('session write failed');
      const { store, sessions, arm } = await setup((op, key) =>
        op === 'set' && key.startsWith('session:') ? boom : undefined,
      );
      arm();
      await expect(sessions.createSession(store, 'u1', 'tok', 0, 100)).rejects.toBe(boom);
      expect(await sessions.resolveSession(store, 'tok', 1)).toBeUndefined();
    },
    T,
  );

  test(
    'read and delete failures reject resolveSession',
    async () => {
      const readErr = new Error('user read failed');
      const a = await setup((op, key) =>
        op === 'get' && key.startsWith('user:') ? readErr : undefined,
      );
      await a.sessions.createSession(a.store, 'u1', 'tok', 0, 100);
      a.arm();
      await expect(a.sessions.resolveSession(a.store, 'tok', 1)).rejects.toBe(readErr);

      const delErr = new Error('delete failed');
      const b = await setup((op) => (op === 'delete' ? delErr : undefined));
      await b.sessions.createSession(b.store, 'u1', 'tok', 0, 100);
      b.arm();
      await expect(b.sessions.resolveSession(b.store, 'tok', 500)).rejects.toBe(delErr);
      await expect(b.sessions.endSession(b.store, 'tok')).rejects.toBe(delErr);
    },
    T,
  );
});

describe('audit', () => {
  test(
    'records and lists entries',
    async () => {
      const { record, history, historyFor } = await load('audit.ts');
      const store = await newStore();
      expect(await history(store)).toEqual([]);
      for (let i = 0; i < 12; i++) await record(store, i % 3 === 0 ? 'ana' : 'ben', `a${i}`, i);
      const all = await history(store);
      expect(all.map((e: { seq: number }) => e.seq)).toEqual(
        Array.from({ length: 12 }, (_, i) => i + 1),
      );
      expect(all[0]).toEqual({ seq: 1, actor: 'ana', action: 'a0', at: 0 });
      const anas = await historyFor(store, 'ana');
      expect(anas.map((e: { action: string }) => e.action)).toEqual(['a0', 'a3', 'a6', 'a9']);
    },
    T,
  );

  test(
    'a failed entry write rejects and does not use up a sequence number',
    async () => {
      const { record, history } = await load('audit.ts');
      const boom = new Error('entry write failed');
      let failNext = false;
      const store = await newStore((op, key) => {
        if (failNext && op === 'set' && key.startsWith('audit:entry:')) {
          failNext = false;
          return boom;
        }
        return undefined;
      });
      await record(store, 'ana', 'one', 1);
      failNext = true;
      await expect(record(store, 'ana', 'two', 2)).rejects.toBe(boom);
      expect((await record(store, 'ana', 'three', 3)).seq).toBe(2);
      expect((await history(store)).map((e: { action: string }) => e.action)).toEqual([
        'one',
        'three',
      ]);
    },
    T,
  );

  test(
    'history rejects when one read fails',
    async () => {
      const { record, history, historyFor } = await load('audit.ts');
      const boom = new Error('entry read failed');
      let armed = false;
      const store = await newStore((op, key) =>
        armed && op === 'get' && key.startsWith('audit:entry:') && key.endsWith('2')
          ? boom
          : undefined,
      );
      for (let i = 0; i < 3; i++) await record(store, 'ana', `a${i}`, i);
      armed = true;
      await expect(history(store)).rejects.toBe(boom);
      await expect(historyFor(store, 'ana')).rejects.toBe(boom);
      const keysErr = new Error('scan failed');
      const store2 = await newStore((op) => (op === 'keys' ? keysErr : undefined));
      await expect(history(store2)).rejects.toBe(keysErr);
    },
    T,
  );
});

describe('no callbacks left', () => {
  for (const name of ['store.ts', 'users.ts', 'sessions.ts', 'audit.ts']) {
    test(name, () => {
      const src = readFileSync(join(dir, 'src', name), 'utf8');
      expect(src).not.toMatch(/\bcb\s*[:,)(?]/);
      expect(src).not.toMatch(/\bcallback\s*[:,)(?]/i);
      expect(src).not.toMatch(/\bCallback\b/);
      expect(src).not.toMatch(/\bdone\s*\(/);
      expect(src).not.toMatch(/promisify/);
    });
  }
});
