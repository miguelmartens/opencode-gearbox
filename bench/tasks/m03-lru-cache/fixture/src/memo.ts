import { LRUCache } from './lru.ts';

/** Wraps a one-argument function with an LRU cache of its results. */
export function memoize<A, R>(fn: (arg: A) => R, capacity = 100): (arg: A) => R {
  const cache = new LRUCache<A, R>(capacity);
  return (arg) => {
    if (cache.has(arg)) return cache.get(arg) as R;
    const result = fn(arg);
    cache.set(arg, result);
    return result;
  };
}
