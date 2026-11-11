export type StoreOp = 'get' | 'set' | 'delete' | 'keys';

/** Node-style callback: `err` is null on success. */
export type Callback<T> = (err: Error | null, value?: T) => void;

export type StoreOptions = {
  /** Fault injection for tests: return an error to make that operation fail. */
  fail?: (op: StoreOp, key: string) => Error | undefined;
};

/**
 * In-memory key/value store with the same contract as our networked one: every operation completes
 * asynchronously, and values are serialized, so callers never share objects with the store.
 */
export class MemoryStore {
  private readonly data = new Map<string, string>();
  private readonly fail: StoreOptions['fail'];

  constructor(options: StoreOptions = {}) {
    this.fail = options.fail;
  }

  get<T>(key: string, cb: Callback<T | undefined>): void {
    this.later('get', key, cb, () => {
      const raw = this.data.get(key);
      return raw === undefined ? undefined : (JSON.parse(raw) as T);
    });
  }

  set(key: string, value: unknown, cb: Callback<void>): void {
    this.later('set', key, cb, () => {
      this.data.set(key, JSON.stringify(value));
    });
  }

  /** Calls back with true when the key existed. */
  delete(key: string, cb: Callback<boolean>): void {
    this.later('delete', key, cb, () => this.data.delete(key));
  }

  /** Keys starting with `prefix`, sorted. */
  keys(prefix: string, cb: Callback<string[]>): void {
    this.later('keys', prefix, cb, () =>
      [...this.data.keys()].filter((key) => key.startsWith(prefix)).sort(),
    );
  }

  private later<T>(op: StoreOp, key: string, cb: Callback<T>, run: () => T): void {
    queueMicrotask(() => {
      const error = this.fail?.(op, key);
      if (error) return cb(error);
      let value: T;
      try {
        value = run();
      } catch (e) {
        return cb(e as Error);
      }
      cb(null, value);
    });
  }
}
