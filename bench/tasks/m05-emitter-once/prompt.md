Add a `once(event, handler)` method to the `Emitter` class in `src/emitter.ts`. A `once` handler runs on the next matching `emit` only and is then removed. Like `on`, it should return an unsubscribe function, and it must keep the same ordering as `on` handlers (registration order). Passing the original handler to `off(event, handler)` must remove a `once` handler before it fires, and `listenerCount` should count it until it fires. Add tests.

Before editing, outline the change in a few bullets.

---

ok, continue
