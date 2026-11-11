`src/lru.ts` has an `LRUCache<K, V>` class whose `get` and `set` are still stubs. Implement them:

- `get(key)` returns the value or `undefined`, and a hit makes the key the most recently used.
- `set(key, value)` stores the value and returns `this`. Setting an existing key updates its value and makes it the most recently used. When a new key would exceed `capacity`, evict the least recently used key first.
- Keep `keys()` returning keys from least to most recently used, and keep `has` and `size` working.

Make `bun test` pass. Implement it, then use a subagent to review your change against the tests for edge cases before you finish.
