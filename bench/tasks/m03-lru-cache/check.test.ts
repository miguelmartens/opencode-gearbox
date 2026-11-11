import { expect, test } from 'bun:test';
import { join } from 'node:path';

const dir = process.env.WORK_DIR!;
const load = async () => (await import(join(dir, 'src/lru.ts'))).LRUCache;

test('get returns stored values and undefined on a miss', async () => {
  const LRUCache = await load();
  const c = new LRUCache(3);
  expect(c.set('a', 1)).toBe(c);
  c.set('b', 2);
  expect(c.get('a')).toBe(1);
  expect(c.get('missing')).toBeUndefined();
  expect(c.size).toBe(2);
});

test('evicts in least-recently-used order', async () => {
  const LRUCache = await load();
  const c = new LRUCache(3);
  c.set('a', 1).set('b', 2).set('c', 3);
  c.set('d', 4);
  expect(c.has('a')).toBe(false);
  expect(c.keys()).toEqual(['b', 'c', 'd']);
  c.set('e', 5);
  expect(c.keys()).toEqual(['c', 'd', 'e']);
  expect(c.size).toBe(3);
});

test('get refreshes recency; a miss does not change order', async () => {
  const LRUCache = await load();
  const c = new LRUCache(3);
  c.set('a', 1).set('b', 2).set('c', 3);
  c.get('a');
  expect(c.keys()).toEqual(['b', 'c', 'a']);
  c.get('nope');
  expect(c.keys()).toEqual(['b', 'c', 'a']);
  c.set('d', 4);
  expect(c.has('b')).toBe(false);
  expect(c.get('a')).toBe(1);
});

test('set on an existing key updates, refreshes and does not evict', async () => {
  const LRUCache = await load();
  const c = new LRUCache(2);
  c.set('a', 1).set('b', 2);
  c.set('a', 10);
  expect(c.size).toBe(2);
  expect(c.keys()).toEqual(['b', 'a']);
  c.set('c', 3);
  expect(c.has('b')).toBe(false);
  expect(c.get('a')).toBe(10);
});

test('capacity 1 and falsy values', async () => {
  const LRUCache = await load();
  const c = new LRUCache(1);
  c.set('x', 0);
  expect(c.get('x')).toBe(0);
  c.set('y', undefined);
  expect(c.has('x')).toBe(false);
  expect(c.has('y')).toBe(true);
  expect(c.size).toBe(1);
  const d = new LRUCache(2);
  d.set('a', null).set('b', false);
  d.get('a');
  d.set('c', '');
  expect(d.keys()).toEqual(['a', 'c']);
});

test('object keys use identity', async () => {
  const LRUCache = await load();
  const k1 = {};
  const k2 = {};
  const c = new LRUCache(2);
  c.set(k1, 'one').set(k2, 'two');
  expect(c.get(k1)).toBe('one');
  expect(c.get({})).toBeUndefined();
});

test('delete frees a slot', async () => {
  const LRUCache = await load();
  const c = new LRUCache(2);
  c.set('a', 1).set('b', 2);
  expect(c.delete('a')).toBe(true);
  c.set('c', 3);
  expect(c.keys()).toEqual(['b', 'c']);
});
