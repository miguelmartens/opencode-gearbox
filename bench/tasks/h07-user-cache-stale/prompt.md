Support keeps reporting stale data from `UserService` in `src/users.ts`, the cache in front of our user database (`src/db.ts`):

- after a user changes their email, signing in with their old address still finds them;
- someone who signed up right after a failed sign-in attempt can't be found by email;
- new and deleted users show up late, or never, in the admin list;
- on one screen a user's name changed before they pressed save.

Fix `UserService` so that every read reflects every write that completed before the read started, and nothing a caller does to a returned object affects what anyone else reads. The database is remote, so reads and writes can overlap. Keep the cache: repeated reads with no write in between must not hit the database again. Don't change `src/db.ts` or the public method signatures. Add tests for what you fix.
