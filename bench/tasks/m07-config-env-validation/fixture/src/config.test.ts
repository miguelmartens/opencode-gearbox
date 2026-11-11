import { expect, test } from 'bun:test';
import { loadConfig } from './config.ts';

test('reads PORT and DEBUG', () => {
  expect(loadConfig({ PORT: '8081', DEBUG: 'true' })).toEqual({ port: 8081, debug: true });
});

test('defaults', () => {
  expect(loadConfig({})).toEqual({ port: 3000, debug: false });
});
