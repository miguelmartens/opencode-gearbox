import { expect, test } from 'bun:test';
import { priceLines } from './pricing.ts';

test('discount is rounded on the subtotal, not per line', () => {
  const lines = [1, 2, 3].map(() => ({ unitCents: 1005, qty: 1 }));
  expect(priceLines(lines, { discountPct: 10 })).toEqual({
    subtotal: 3015,
    discount: 302,
    tax: 0,
    total: 2713,
  });
});

test('negative amounts round half away from zero', () => {
  expect(priceLines([{ unitCents: -250, qty: 1 }], { taxPct: 1 })).toEqual({
    subtotal: -250,
    discount: 0,
    tax: -3,
    total: -253,
  });
});

test('out-of-range percentages are rejected', () => {
  expect(() => priceLines([], { discountPct: 101 })).toThrow(RangeError);
  expect(() => priceLines([], { taxPct: -1 })).toThrow(RangeError);
});
