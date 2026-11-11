import type { MemoryStore } from './store.ts';
import { getUser } from './users.ts';
import type { User } from './users.ts';

export type Session = { token: string; userId: string; expiresAt: number };

const sessionKey = (token: string) => `session:${token}`;

export async function createSession(
  store: MemoryStore,
  userId: string,
  token: string,
  now: number,
  ttlMs: number,
): Promise<Session> {
  const user = await getUser(store, userId);
  if (!user) throw new Error(`unknown user ${userId}`);
  const session: Session = { token, userId, expiresAt: now + ttlMs };
  await store.set(sessionKey(token), session);
  return session;
}

/** The session's user, or undefined for unknown or expired tokens. Expired sessions are removed. */
export async function resolveSession(
  store: MemoryStore,
  token: string,
  now: number,
): Promise<User | undefined> {
  const session = await store.get<Session>(sessionKey(token));
  if (!session) return undefined;
  if (session.expiresAt <= now) {
    await store.delete(sessionKey(token));
    return undefined;
  }
  return getUser(store, session.userId);
}

/** Resolves to true when the session existed. */
export function endSession(store: MemoryStore, token: string): Promise<boolean> {
  return store.delete(sessionKey(token));
}
