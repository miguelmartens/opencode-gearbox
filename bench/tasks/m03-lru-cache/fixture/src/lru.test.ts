import { expect, test } from 'bun:test';
import { LRUCache } from './lru.ts';

test('stores and reads values', () => {
  const c = new LRUCache<string, number>(2);
  c.set('a', 1).set('b', 2);
  expect(c.get('a')).toBe(1);
  expect(c.get('b')).toBe(2);
  expect(c.get('z')).toBeUndefined();
});

test('evicts the least recently used key', () => {
  const c = new LRUCache<string, number>(2);
  c.set('a', 1);
  c.set('b', 2);
  c.get('a');
  c.set('c', 3);
  expect(c.has('b')).toBe(false);
  expect(c.keys()).toEqual(['a', 'c']);
});

test('rejects a bad capacity', () => {
  expect(() => new LRUCache(0)).toThrow(RangeError);
});
