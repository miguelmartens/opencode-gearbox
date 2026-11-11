import { expect, test } from 'bun:test';
import { computeTotal } from './total.ts';

test('sums lines', () => {
  expect(computeTotal([{ price: 2, qty: 3 }, { price: 1.5, qty: 2 }])).toBe(9);
});
