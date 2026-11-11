import { expect, test } from 'bun:test';
import { paginate } from './pager.ts';
import { parseLimit } from './api.ts';

const items = Array.from({ length: 100 }, (_, i) => i);

test('paginate', () => {
  expect(paginate(items, 2, 10)).toEqual([10, 11, 12, 13, 14, 15, 16, 17, 18, 19]);
  expect(paginate(items, 1, 500)).toHaveLength(30);
});

test('parseLimit', () => {
  expect(parseLimit('5')).toBe(5);
  expect(parseLimit(undefined)).toBe(30);
  expect(parseLimit('999')).toBe(30);
});
