Our storage layer still uses node-style callbacks: `MemoryStore` in `src/store.ts` has `get(key, cb)`, `set(key, value, cb)`, `delete(key, cb)` and `keys(prefix, cb)`, and `src/users.ts`, `src/sessions.ts` and `src/audit.ts` are built on top of it with more callbacks. Convert all of it to async/await.

Target API:

- `src/store.ts`: `get<T>(key): Promise<T | undefined>`, `set(key, value): Promise<void>`, `delete(key): Promise<boolean>`, `keys(prefix): Promise<string[]>`. Failures, including the ones from the `fail` option, become rejections with the same error object. Keep `StoreOp`, `StoreOptions` and the copy-on-read/write behaviour. Remove the `Callback` type.
- `src/users.ts`: `createUser(store, input, now): Promise<User>`, `getUser(store, id): Promise<User | undefined>`, `renameUser(store, id, name): Promise<User>`.
- `src/sessions.ts`: `createSession(store, userId, token, now, ttlMs): Promise<Session>`, `resolveSession(store, token, now): Promise<User | undefined>`, `endSession(store, token): Promise<boolean>`.
- `src/audit.ts`: `record(store, actor, action, now): Promise<AuditEntry>`, `history(store): Promise<AuditEntry[]>`, `historyFor(store, actor): Promise<AuditEntry[]>`.

Keep the behaviour exactly as it is, including error propagation: every error that reaches a callback today, from validation or from the store, must reject the returned promise. For example, a failing `set` of the session record must reject `createSession`, and a failed audit entry write must not use up a sequence number. No callback parameters or `promisify` wrappers should remain in these four files. Update the tests to the new API.

Use subagents (the task tool) for this: once `store.ts` is converted, have subagents convert `users.ts`, `sessions.ts` and `audit.ts` (with their tests) in parallel, then have a subagent review the whole conversion for lost errors and missing `await`s before you finish.
