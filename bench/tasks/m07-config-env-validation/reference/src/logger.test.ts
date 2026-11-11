import { expect, test } from 'bun:test';
import { createLogger } from './logger.ts';

test('debug lines only when config.debug is on', () => {
  const lines: string[] = [];
  createLogger('t', { debug: true }, (l) => lines.push(l)).debug('x');
  createLogger('t', { debug: false }, (l) => lines.push(l)).debug('y');
  expect(lines).toEqual(['[t] debug: x']);
});
