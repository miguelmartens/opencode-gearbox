/**
 * A fixed-capacity cache that evicts the least recently used entry when full.
 * Both `get` (on a hit) and `set` count as a use.
 */
export class LRUCache<K, V> {
  readonly capacity: number;
  private readonly entries = new Map<K, V>();

  constructor(capacity: number) {
    if (!Number.isInteger(capacity) || capacity < 1)
      throw new RangeError(`capacity must be a positive integer, got ${capacity}`);
    this.capacity = capacity;
  }

  get size(): number {
    return this.entries.size;
  }

  /** True when `key` is cached. Does not count as a use. */
  has(key: K): boolean {
    return this.entries.has(key);
  }

  /** Keys from least to most recently used. */
  keys(): K[] {
    return [...this.entries.keys()];
  }

  /** The cached value, or `undefined` on a miss. A hit makes `key` the most recently used. */
  get(key: K): V | undefined {
    if (!this.entries.has(key)) return undefined;
    const value = this.entries.get(key) as V;
    this.entries.delete(key);
    this.entries.set(key, value);
    return value;
  }

  /** Stores `value`, making `key` the most recently used. Evicts the least recently used key when full. */
  set(key: K, value: V): this {
    if (this.entries.has(key)) this.entries.delete(key);
    else if (this.entries.size >= this.capacity) {
      const oldest = this.entries.keys().next().value as K;
      this.entries.delete(oldest);
    }
    this.entries.set(key, value);
    return this;
  }

  delete(key: K): boolean {
    return this.entries.delete(key);
  }
}
