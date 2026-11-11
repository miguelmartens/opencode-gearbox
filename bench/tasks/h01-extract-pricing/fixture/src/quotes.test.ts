import { expect, test } from 'bun:test';
import { quoteSummary, quoteTotals } from './quotes.ts';

const quote = {
  client: 'Acme',
  lines: [
    { description: 'design', rateCents: 9000, hours: 4 },
    { description: 'build', rateCents: 11000, hours: 10 },
  ],
  discountPct: 5,
  taxPct: 20,
};

test('quote totals', () => {
  expect(quoteTotals(quote)).toEqual({
    subtotal: 146000,
    discount: 7300,
    tax: 27740,
    total: 166440,
  });
});

test('quote summary', () => {
  expect(quoteSummary(quote)).toBe('Quote for Acme: 14h, 1664.40 incl. 277.40 tax');
});
