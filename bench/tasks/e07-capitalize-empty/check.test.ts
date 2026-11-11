import { expect, test } from 'bun:test';
import { join } from 'node:path';

const dir = process.env.WORK_DIR!;

test('empty string stays empty', async () => {
  const { capitalize } = await import(join(dir, 'src/strings.ts'));
  expect(capitalize('')).toBe('');
});

test('other inputs behave as before', async () => {
  const { capitalize } = await import(join(dir, 'src/strings.ts'));
  expect(capitalize('a')).toBe('A');
  expect(capitalize('hello')).toBe('Hello');
  expect(capitalize('Hello')).toBe('Hello');
  expect(capitalize('hELLO')).toBe('HELLO');
  expect(capitalize('élan')).toBe('Élan');
  expect(capitalize(' x')).toBe(' x');
  expect(capitalize('1st')).toBe('1st');
});

test('titleCase copes with double spaces', async () => {
  const { titleCase } = await import(join(dir, 'src/strings.ts'));
  expect(titleCase('a  b')).toBe('A  B');
  expect(titleCase('')).toBe('');
  expect(titleCase('the quick fox')).toBe('The Quick Fox');
});
