import { expect, test } from 'bun:test';
import { ConfigError, loadConfig } from './config.ts';

test('reads PORT and DEBUG', () => {
  expect(loadConfig({ PORT: '8081', DEBUG: 'true' })).toEqual({ port: 8081, debug: true });
  expect(loadConfig({ DEBUG: 'YES' }).debug).toBe(true);
  expect(loadConfig({ DEBUG: 'No' }).debug).toBe(false);
});

test('defaults', () => {
  expect(loadConfig({})).toEqual({ port: 3000, debug: false });
  expect(loadConfig({ PORT: '', DEBUG: '' })).toEqual({ port: 3000, debug: false });
});

test('rejects bad values with the variable name', () => {
  for (const PORT of ['0', '65536', 'abc', '80.5', '-1'])
    expect(() => loadConfig({ PORT })).toThrow(ConfigError);
  expect(() => loadConfig({ PORT: 'abc' })).toThrow(/PORT/);
  expect(() => loadConfig({ DEBUG: 'maybe' })).toThrow(/DEBUG/);
});
