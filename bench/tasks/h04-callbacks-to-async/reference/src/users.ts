import type { MemoryStore } from './store.ts';

export type User = { id: string; email: string; name: string; createdAt: number };
export type NewUser = { id: string; email: string; name: string };

const userKey = (id: string) => `user:${id}`;

export async function createUser(store: MemoryStore, input: NewUser, now: number): Promise<User> {
  if (!input.email.includes('@')) throw new Error(`invalid email: ${input.email}`);
  const existing = await store.get<User>(userKey(input.id));
  if (existing) throw new Error(`user ${input.id} already exists`);
  const user: User = { ...input, email: input.email.toLowerCase(), createdAt: now };
  await store.set(userKey(user.id), user);
  return user;
}

export function getUser(store: MemoryStore, id: string): Promise<User | undefined> {
  return store.get<User>(userKey(id));
}

export async function renameUser(store: MemoryStore, id: string, name: string): Promise<User> {
  const trimmed = name.trim();
  if (trimmed === '') throw new Error('name must not be empty');
  const user = await getUser(store, id);
  if (!user) throw new Error(`no user ${id}`);
  const renamed = { ...user, name: trimmed };
  await store.set(userKey(id), renamed);
  return renamed;
}
