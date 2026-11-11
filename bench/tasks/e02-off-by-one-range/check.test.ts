import { expect, test } from 'bun:test';
import { join } from 'node:path';

const dir = process.env.WORK_DIR!;

test('range is inclusive on both ends', async () => {
  const { range } = await import(join(dir, 'src/range.ts'));
  expect(range(1, 3)).toEqual([1, 2, 3]);
  expect(range(0, 0)).toEqual([0]);
  expect(range(5, 5)).toEqual([5]);
  expect(range(-2, 1)).toEqual([-2, -1, 0, 1]);
});

test('range is empty when end < start', async () => {
  const { range } = await import(join(dir, 'src/range.ts'));
  expect(range(3, 1)).toEqual([]);
  expect(range(1, 0)).toEqual([]);
});

test('pageNumbers covers every page', async () => {
  const { pageNumbers } = await import(join(dir, 'src/pages.ts'));
  expect(pageNumbers(25, 10)).toEqual([1, 2, 3]);
  expect(pageNumbers(30, 10)).toEqual([1, 2, 3]);
  expect(pageNumbers(1, 10)).toEqual([1]);
  expect(pageNumbers(0, 10)).toEqual([]);
});
