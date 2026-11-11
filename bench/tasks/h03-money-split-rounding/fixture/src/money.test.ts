import { expect, test } from 'bun:test';
import { formatMoney, sumCents } from './money.ts';

test('formats cents', () => {
  expect(formatMoney(1234)).toBe('€12.34');
  expect(formatMoney(5)).toBe('€0.05');
  expect(formatMoney(0)).toBe('€0.00');
  expect(formatMoney(100000, 'USD')).toBe('$1000.00');
  expect(formatMoney(250, 'CHF')).toBe('CHF 2.50');
});

test('sums cents', () => {
  expect(sumCents([1, 2, 3])).toBe(6);
  expect(sumCents([])).toBe(0);
});
