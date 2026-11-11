import { expect, test } from 'bun:test';
import { join } from 'node:path';

const dir = process.env.WORK_DIR!;

test('isEven works for negative and positive integers', async () => {
  const { isEven } = await import(join(dir, 'src/parity.ts'));
  for (const n of [-10, -4, -2, 0, 2, 8, 1000]) expect(isEven(n)).toBe(true);
  for (const n of [-11, -3, -1, 1, 3, 9, 1001]) expect(isEven(n)).toBe(false);
});

test('isOdd agrees', async () => {
  const { isOdd } = await import(join(dir, 'src/parity.ts'));
  expect(isOdd(-1)).toBe(true);
  expect(isOdd(-3)).toBe(true);
  expect(isOdd(-2)).toBe(false);
  expect(isOdd(5)).toBe(true);
  expect(isOdd(0)).toBe(false);
});

test('filters split mixed lists', async () => {
  const { evens, odds } = await import(join(dir, 'src/filter.ts'));
  expect(evens([-3, -2, -1, 0, 1, 2])).toEqual([-2, 0, 2]);
  expect(odds([-3, -2, -1, 0, 1, 2])).toEqual([-3, -1, 1]);
});
