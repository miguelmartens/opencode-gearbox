import { expect, test } from 'bun:test';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

const dir = process.env.WORK_DIR!;

test('parseArgs understands --version and -v', async () => {
  const { parseArgs } = await import(join(dir, 'src/args.ts'));
  expect(parseArgs(['--version'])).toEqual({ command: 'version' });
  expect(parseArgs(['-v'])).toEqual({ command: 'version' });
});

test('main prints the version constant', async () => {
  const { main } = await import(join(dir, 'src/cli.ts'));
  const { VERSION } = await import(join(dir, 'src/version.ts'));
  expect(VERSION).toBe('1.4.2');
  expect(main(['--version'])).toBe(VERSION);
  expect(main(['-v'])).toBe(VERSION);
});

test('existing commands are unchanged', async () => {
  const { parseArgs } = await import(join(dir, 'src/args.ts'));
  const { main } = await import(join(dir, 'src/cli.ts'));
  expect(parseArgs(['run', 'x.md'])).toEqual({ command: 'run', file: 'x.md' });
  expect(parseArgs([])).toEqual({ command: 'help' });
  expect(parseArgs(['--help'])).toEqual({ command: 'help' });
  expect(() => parseArgs(['--verbose'])).toThrow('Unknown arguments');
  expect(() => parseArgs(['run'])).toThrow('Unknown arguments');
  expect(main(['run', 'x.md'])).toBe('Rendering x.md');
  expect(main(['-h'])).toContain('Usage: notes');
});

test('the version string is not duplicated', () => {
  for (const f of ['args.ts', 'cli.ts'])
    expect(readFileSync(join(dir, 'src', f), 'utf8')).not.toContain('1.4.2');
});
