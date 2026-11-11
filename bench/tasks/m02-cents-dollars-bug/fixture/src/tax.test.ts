import { expect, test } from 'bun:test';
import { taxFor } from './tax.ts';

test('taxFor works in dollars', () => {
  expect(taxFor(100, 'NY')).toBe(8);
  expect(taxFor(19.99, 'TX')).toBe(1.25);
  expect(taxFor(42, 'OR')).toBe(0);
});
