import { expect, test } from 'bun:test';
import { splitBill, splitEvenly } from './split.ts';

test('splits in proportion to the weights', () => {
  expect(splitBill(1000, [1, 3])).toEqual([250, 750]);
  expect(splitBill(600, [1, 2, 3])).toEqual([100, 200, 300]);
});

test('splits evenly', () => {
  expect(splitEvenly(900, 3)).toEqual([300, 300, 300]);
});

test('shares always add up to the total', () => {
  expect(splitEvenly(100, 3)).toEqual([34, 33, 33]);
  expect(splitBill(101, [1, 1])).toEqual([51, 50]);
  expect(splitBill(100, [2, 1])).toEqual([67, 33]);
});

test('refunds split symmetrically', () => {
  expect(splitBill(-100, [1, 1, 1])).toEqual([-34, -33, -33]);
  expect(splitBill(-101, [1, 1])).toEqual([-51, -50]);
});

test('rejects unusable weights', () => {
  expect(() => splitBill(100, [])).toThrow(RangeError);
  expect(() => splitBill(100, [0, 0])).toThrow(RangeError);
  expect(() => splitBill(100, [1, -1])).toThrow(RangeError);
});
