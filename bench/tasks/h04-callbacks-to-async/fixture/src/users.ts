import type { Callback, MemoryStore } from './store.ts';

export type User = { id: string; email: string; name: string; createdAt: number };
export type NewUser = { id: string; email: string; name: string };

const userKey = (id: string) => `user:${id}`;

export function createUser(store: MemoryStore, input: NewUser, now: number, cb: Callback<User>) {
  if (!input.email.includes('@')) return cb(new Error(`invalid email: ${input.email}`));
  store.get<User>(userKey(input.id), (err, existing) => {
    if (err) return cb(err);
    if (existing) return cb(new Error(`user ${input.id} already exists`));
    const user: User = { ...input, email: input.email.toLowerCase(), createdAt: now };
    store.set(userKey(user.id), user, (setErr) => {
      if (setErr) return cb(setErr);
      cb(null, user);
    });
  });
}

export function getUser(store: MemoryStore, id: string, cb: Callback<User | undefined>) {
  store.get<User>(userKey(id), cb);
}

export function renameUser(store: MemoryStore, id: string, name: string, cb: Callback<User>) {
  const trimmed = name.trim();
  if (trimmed === '') return cb(new Error('name must not be empty'));
  getUser(store, id, (err, user) => {
    if (err) return cb(err);
    if (!user) return cb(new Error(`no user ${id}`));
    const renamed = { ...user, name: trimmed };
    store.set(userKey(id), renamed, (setErr) => (setErr ? cb(setErr) : cb(null, renamed)));
  });
}
