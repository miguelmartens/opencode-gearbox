import { expect, test } from 'bun:test';
import { splitBill, splitEvenly } from './split.ts';

test('splits in proportion to the weights', () => {
  expect(splitBill(1000, [1, 3])).toEqual([250, 750]);
  expect(splitBill(600, [1, 2, 3])).toEqual([100, 200, 300]);
});

test('splits evenly', () => {
  expect(splitEvenly(900, 3)).toEqual([300, 300, 300]);
});
