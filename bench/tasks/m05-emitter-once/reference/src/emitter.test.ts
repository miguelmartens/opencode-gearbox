import { expect, test } from 'bun:test';
import { Emitter } from './emitter.ts';

type Events = { ping: [n: number]; done: [] };

test('on and emit', () => {
  const e = new Emitter<Events>();
  const seen: number[] = [];
  e.on('ping', (n) => seen.push(n));
  e.emit('ping', 1);
  e.emit('ping', 2);
  expect(seen).toEqual([1, 2]);
});

test('off and the returned unsubscribe remove a handler', () => {
  const e = new Emitter<Events>();
  let calls = 0;
  const h = () => calls++;
  e.on('done', h);
  const stop = e.on('ping', h);
  e.off('done', h);
  stop();
  e.emit('done');
  e.emit('ping', 1);
  expect(calls).toBe(0);
  expect(e.listenerCount('ping')).toBe(0);
});

test('once fires a single time', () => {
  const e = new Emitter<Events>();
  const seen: number[] = [];
  e.once('ping', (n) => seen.push(n));
  expect(e.listenerCount('ping')).toBe(1);
  e.emit('ping', 1);
  e.emit('ping', 2);
  expect(seen).toEqual([1]);
  expect(e.listenerCount('ping')).toBe(0);
});

test('off removes a once handler before it fires', () => {
  const e = new Emitter<Events>();
  let calls = 0;
  const h = () => calls++;
  e.once('done', h);
  e.off('done', h);
  e.emit('done');
  expect(calls).toBe(0);
});
