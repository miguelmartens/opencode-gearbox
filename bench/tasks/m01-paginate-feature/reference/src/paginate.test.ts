import { expect, test } from 'bun:test';
import { paginate } from './paginate.ts';

const nums = [1, 2, 3, 4, 5, 6, 7];

test('first page', () => {
  expect(paginate(nums, 1, 3)).toEqual({ items: [1, 2, 3], page: 1, totalPages: 3, hasNext: true });
});

test('last partial page', () => {
  expect(paginate(nums, 3, 3)).toEqual({ items: [7], page: 3, totalPages: 3, hasNext: false });
});

test('page below 1 clamps to 1', () => {
  expect(paginate(nums, 0, 3).page).toBe(1);
  expect(paginate(nums, -2, 3).items).toEqual([1, 2, 3]);
});

test('page past the end is empty', () => {
  expect(paginate(nums, 9, 3)).toEqual({ items: [], page: 9, totalPages: 3, hasNext: false });
});

test('empty input', () => {
  expect(paginate([], 1, 5)).toEqual({ items: [], page: 1, totalPages: 0, hasNext: false });
});

test('size must be positive', () => {
  expect(() => paginate(nums, 1, 0)).toThrow(RangeError);
  expect(() => paginate(nums, 1, -1)).toThrow(RangeError);
});
