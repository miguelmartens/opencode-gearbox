import { afterAll, beforeAll, expect, test } from 'bun:test';
import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';

const dir = process.env.WORK_DIR!;
const config = async () => await import(join(dir, 'src/config.ts'));

// Poison the real environment: nothing but `start(env)` should be able to see these.
const saved = { PORT: process.env.PORT, DEBUG: process.env.DEBUG };
beforeAll(() => {
  process.env.PORT = '1111';
  process.env.DEBUG = '1';
});
afterAll(() => {
  for (const [k, v] of Object.entries(saved)) {
    if (v === undefined) delete process.env[k];
    else process.env[k] = v;
  }
});

test('PORT parsing', async () => {
  const { loadConfig } = await config();
  expect(loadConfig({}).port).toBe(3000);
  expect(loadConfig({ PORT: '' }).port).toBe(3000);
  expect(loadConfig({ PORT: '1' }).port).toBe(1);
  expect(loadConfig({ PORT: '8080' }).port).toBe(8080);
  expect(loadConfig({ PORT: '65535' }).port).toBe(65535);
});

test('bad PORT throws ConfigError naming PORT', async () => {
  const { loadConfig, ConfigError } = await config();
  expect(typeof ConfigError).toBe('function');
  for (const PORT of ['0', '65536', '-1', 'abc', '80.5', '80abc', '1e3', '0x50', '99999999']) {
    let err: unknown;
    try {
      loadConfig({ PORT });
    } catch (e) {
      err = e;
    }
    expect(err, `PORT=${PORT}`).toBeInstanceOf(ConfigError);
    expect(err).toBeInstanceOf(Error);
    expect((err as Error).message).toContain('PORT');
  }
});

test('DEBUG parsing', async () => {
  const { loadConfig } = await config();
  for (const DEBUG of ['1', 'true', 'TRUE', 'True', 'yes', 'YES', 'Yes'])
    expect(loadConfig({ DEBUG }).debug, DEBUG).toBe(true);
  for (const DEBUG of ['0', 'false', 'FALSE', 'no', 'No', '', undefined])
    expect(loadConfig({ DEBUG }).debug, String(DEBUG)).toBe(false);
});

test('bad DEBUG throws ConfigError naming DEBUG', async () => {
  const { loadConfig, ConfigError } = await config();
  for (const DEBUG of ['on', '2', 'maybe', 'y']) {
    let err: unknown;
    try {
      loadConfig({ DEBUG, PORT: '80' });
    } catch (e) {
      err = e;
    }
    expect(err, `DEBUG=${DEBUG}`).toBeInstanceOf(ConfigError);
    expect((err as Error).message).toContain('DEBUG');
    expect((err as Error).message).not.toContain('PORT');
  }
});

test('logger and server take the config', async () => {
  const { createLogger } = await import(join(dir, 'src/logger.ts'));
  const { describeServer } = await import(join(dir, 'src/server.ts'));
  const lines: string[] = [];
  createLogger('a', { port: 1, debug: false }, (l: string) => lines.push(l)).debug('hidden');
  createLogger('b', { port: 1, debug: true }, (l: string) => lines.push(l)).debug('shown');
  expect(lines).toEqual(['[b] debug: shown']);
  expect(describeServer({ port: 4242, debug: false })).toContain(':4242');
});

test('start uses only the env it is given', async () => {
  const { start } = await import(join(dir, 'src/main.ts'));
  const { ConfigError } = await config();
  const quiet: string[] = [];
  expect(start({}, (l: string) => quiet.push(l))).toEqual({ port: 3000, debug: false });
  expect(quiet.join('\n')).toContain(':3000');
  expect(quiet.join('\n')).not.toContain('debug:');
  const loud: string[] = [];
  start({ PORT: '9090', DEBUG: 'Yes' }, (l: string) => loud.push(l));
  expect(loud.join('\n')).toContain(':9090');
  expect(loud.join('\n')).toContain('debug:');
  expect(() => start({ PORT: 'nope' }, () => {})).toThrow(ConfigError);
});

test('only src/main.ts reads process.env', () => {
  const files = readdirSync(join(dir, 'src')).filter(
    (f) => f.endsWith('.ts') && !f.endsWith('.test.ts') && f !== 'main.ts',
  );
  for (const f of files)
    expect(readFileSync(join(dir, 'src', f), 'utf8'), f).not.toMatch(/process\.env|Bun\.env/);
});
