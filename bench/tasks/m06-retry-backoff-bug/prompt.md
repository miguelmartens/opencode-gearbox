Our retry helper is misbehaving. `retry(fn, { attempts: 3 })` from `src/retry.ts` only calls `fn` twice before giving up, and the waits between tries are too long: with `attempts: 4` the waits should be 100, 200, 400 ms, but `backoffDelays` in `src/backoff.ts` gives 200, 400, 800.

Fix both so that `attempts` is the total number of calls and `backoffDelays(count, baseMs = 100, maxMs = 10_000)` returns `count` waits starting at `baseMs`, doubling, each capped at `maxMs`. Keep the injectable `sleep` option, and update the tests so they would catch this.
