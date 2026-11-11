import { expect, test } from 'bun:test';
import { parseArgs } from './args.ts';
import { main } from './cli.ts';

test('parses run and help', () => {
  expect(parseArgs(['run', 'todo.md'])).toEqual({ command: 'run', file: 'todo.md' });
  expect(parseArgs([])).toEqual({ command: 'help' });
  expect(parseArgs(['-h'])).toEqual({ command: 'help' });
});

test('rejects unknown arguments', () => {
  expect(() => parseArgs(['--nope'])).toThrow('Unknown arguments: --nope');
});

test('main renders', () => {
  expect(main(['run', 'a.md'])).toBe('Rendering a.md');
  expect(main(['--help'])).toContain('Usage: notes');
});
