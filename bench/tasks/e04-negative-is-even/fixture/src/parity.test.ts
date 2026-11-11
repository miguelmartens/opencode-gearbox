import { expect, test } from 'bun:test';
import { isEven, isOdd } from './parity.ts';
import { evens } from './filter.ts';

test('positive numbers', () => {
  expect(isEven(0)).toBe(true);
  expect(isEven(4)).toBe(true);
  expect(isEven(7)).toBe(false);
  expect(isOdd(7)).toBe(true);
});

test('evens keeps even values', () => {
  expect(evens([1, 2, 3, 4])).toEqual([2, 4]);
});
