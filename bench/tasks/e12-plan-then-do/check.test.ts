import { expect, test } from 'bun:test';
import { join } from 'node:path';

const dir = process.env.WORK_DIR!;

test('trimAll trims and drops empty strings, keeping order', async () => {
  const { trimAll } = await import(join(dir, 'src/text.ts'));
  expect(trimAll(['  a ', '', '   ', 'b', '\tc\n'])).toEqual(['a', 'b', 'c']);
  expect(trimAll(['x y  ', ' z'])).toEqual(['x y', 'z']);
  expect(trimAll([])).toEqual([]);
  expect(trimAll(['', ' ', '\n'])).toEqual([]);
  expect(trimAll(['0', ' false '])).toEqual(['0', 'false']);
});

test('trimAll does not mutate its input', async () => {
  const { trimAll } = await import(join(dir, 'src/text.ts'));
  const input = [' a ', ''];
  trimAll(input);
  expect(input).toEqual([' a ', '']);
});

test('existing helpers still work', async () => {
  const { collapseSpaces, slugify } = await import(join(dir, 'src/text.ts'));
  expect(collapseSpaces('a  b')).toBe('a b');
  expect(slugify('Hi There')).toBe('hi-there');
});
