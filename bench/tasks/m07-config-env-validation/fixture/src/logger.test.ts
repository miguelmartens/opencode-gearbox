import { afterEach, expect, test } from 'bun:test';
import { createLogger } from './logger.ts';

const saved = process.env.DEBUG;
afterEach(() => {
  if (saved === undefined) delete process.env.DEBUG;
  else process.env.DEBUG = saved;
});

test('debug lines only with DEBUG=1', () => {
  const lines: string[] = [];
  process.env.DEBUG = '1';
  createLogger('t', (l) => lines.push(l)).debug('x');
  process.env.DEBUG = '0';
  createLogger('t', (l) => lines.push(l)).debug('y');
  expect(lines).toEqual(['[t] debug: x']);
});
