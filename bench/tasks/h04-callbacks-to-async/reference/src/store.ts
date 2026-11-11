export type StoreOp = 'get' | 'set' | 'delete' | 'keys';

export type StoreOptions = {
  /** Fault injection for tests: return an error to make that operation fail. */
  fail?: (op: StoreOp, key: string) => Error | undefined;
};

/**
 * In-memory key/value store with the same contract as our networked one: every operation completes
 * asynchronously, and values are serialized, so callers never share objects with the store.
 * Failures are rejections.
 */
export class MemoryStore {
  private readonly data = new Map<string, string>();
  private readonly fail: StoreOptions['fail'];

  constructor(options: StoreOptions = {}) {
    this.fail = options.fail;
  }

  get<T>(key: string): Promise<T | undefined> {
    return this.later('get', key, () => {
      const raw = this.data.get(key);
      return raw === undefined ? undefined : (JSON.parse(raw) as T);
    });
  }

  set(key: string, value: unknown): Promise<void> {
    return this.later('set', key, () => {
      this.data.set(key, JSON.stringify(value));
    });
  }

  /** Resolves to true when the key existed. */
  delete(key: string): Promise<boolean> {
    return this.later('delete', key, () => this.data.delete(key));
  }

  /** Keys starting with `prefix`, sorted. */
  keys(prefix: string): Promise<string[]> {
    return this.later('keys', prefix, () =>
      [...this.data.keys()].filter((key) => key.startsWith(prefix)).sort(),
    );
  }

  private async later<T>(op: StoreOp, key: string, run: () => T): Promise<T> {
    await null;
    const error = this.fail?.(op, key);
    if (error) throw error;
    return run();
  }
}
