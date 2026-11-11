import type { Callback, MemoryStore } from './store.ts';
import { getUser } from './users.ts';
import type { User } from './users.ts';

export type Session = { token: string; userId: string; expiresAt: number };

const sessionKey = (token: string) => `session:${token}`;

export function createSession(
  store: MemoryStore,
  userId: string,
  token: string,
  now: number,
  ttlMs: number,
  cb: Callback<Session>,
) {
  getUser(store, userId, (err, user) => {
    if (err) return cb(err);
    if (!user) return cb(new Error(`unknown user ${userId}`));
    const session: Session = { token, userId, expiresAt: now + ttlMs };
    store.set(sessionKey(token), session, (setErr) => (setErr ? cb(setErr) : cb(null, session)));
  });
}

/** The session's user, or undefined for unknown or expired tokens. Expired sessions are removed. */
export function resolveSession(
  store: MemoryStore,
  token: string,
  now: number,
  cb: Callback<User | undefined>,
) {
  store.get<Session>(sessionKey(token), (err, session) => {
    if (err) return cb(err);
    if (!session) return cb(null, undefined);
    if (session.expiresAt <= now) {
      store.delete(sessionKey(token), (delErr) => (delErr ? cb(delErr) : cb(null, undefined)));
      return;
    }
    getUser(store, session.userId, cb);
  });
}

/** Calls back with true when the session existed. */
export function endSession(store: MemoryStore, token: string, cb: Callback<boolean>) {
  store.delete(sessionKey(token), cb);
}
