import { expect, test } from 'bun:test';
import { join } from 'node:path';

const dir = process.env.WORK_DIR!;
const load = async () => (await import(join(dir, 'src/emitter.ts'))).Emitter;

test('once fires exactly once with the emitted args', async () => {
  const Emitter = await load();
  const e = new Emitter();
  const seen: unknown[][] = [];
  e.once('ping', (...args: unknown[]) => seen.push(args));
  e.emit('ping', 1, 'a');
  e.emit('ping', 2, 'b');
  expect(seen).toEqual([[1, 'a']]);
});

test('listenerCount counts a pending once handler', async () => {
  const Emitter = await load();
  const e = new Emitter();
  e.once('ping', () => {});
  e.on('ping', () => {});
  expect(e.listenerCount('ping')).toBe(2);
  e.emit('ping');
  expect(e.listenerCount('ping')).toBe(1);
});

test('off with the original handler removes a once handler', async () => {
  const Emitter = await load();
  const e = new Emitter();
  let calls = 0;
  const h = () => calls++;
  e.once('ping', h);
  e.off('ping', h);
  expect(e.listenerCount('ping')).toBe(0);
  e.emit('ping');
  expect(calls).toBe(0);
});

test('once returns an unsubscribe function', async () => {
  const Emitter = await load();
  const e = new Emitter();
  let calls = 0;
  const stop = e.once('ping', () => calls++);
  expect(typeof stop).toBe('function');
  stop();
  e.emit('ping');
  expect(calls).toBe(0);
  expect(e.listenerCount('ping')).toBe(0);
});

test('on and once keep registration order', async () => {
  const Emitter = await load();
  const e = new Emitter();
  const log: string[] = [];
  e.on('ping', () => log.push('a'));
  e.once('ping', () => log.push('b'));
  e.on('ping', () => log.push('c'));
  e.emit('ping');
  e.emit('ping');
  expect(log).toEqual(['a', 'b', 'c', 'a', 'c']);
});

test('re-emitting inside a once handler does not fire it twice', async () => {
  const Emitter = await load();
  const e = new Emitter();
  let calls = 0;
  e.once('ping', () => {
    calls++;
    e.emit('ping');
  });
  e.emit('ping');
  expect(calls).toBe(1);
});

test('once on one event does not affect another', async () => {
  const Emitter = await load();
  const e = new Emitter();
  let calls = 0;
  const h = () => calls++;
  e.once('a', h);
  e.once('b', h);
  e.emit('a');
  e.off('b', h);
  e.emit('b');
  expect(calls).toBe(1);
});

test('on still works and off does not remove other handlers', async () => {
  const Emitter = await load();
  const e = new Emitter();
  const log: string[] = [];
  const h1 = () => log.push('1');
  const h2 = () => log.push('2');
  e.on('x', h1);
  e.once('x', h2);
  e.off('x', h1);
  e.emit('x');
  e.emit('x');
  expect(log).toEqual(['2']);
});

test('the project has a test that calls once', async () => {
  const { readdirSync, readFileSync } = await import('node:fs');
  const files = readdirSync(join(dir, 'src')).filter((f: string) => f.endsWith('.test.ts'));
  const src = files.map((f: string) => readFileSync(join(dir, 'src', f), 'utf8')).join('\n');
  expect(src).toMatch(/\.once\(/);
});
