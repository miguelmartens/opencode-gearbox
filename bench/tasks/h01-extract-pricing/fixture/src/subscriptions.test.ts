import { expect, test } from 'bun:test';
import { invoiceLabel, periodInvoice } from './subscriptions.ts';

const team = { name: 'Team', seatCents: 1500, annualDiscountPct: 20 };

test('monthly invoice', () => {
  const sub = { plan: team, seats: 4, billing: 'monthly' as const, taxPct: 10 };
  expect(periodInvoice(sub)).toEqual({ subtotal: 6000, discount: 0, tax: 600, total: 6600 });
  expect(invoiceLabel(sub)).toBe('Charge 66.00');
});

test('annual invoice with a credit', () => {
  const sub = { plan: team, seats: 2, billing: 'annual' as const, taxPct: 10 };
  expect(periodInvoice(sub, [{ reason: 'proration', cents: 1000 }])).toEqual({
    subtotal: 2000,
    discount: 400,
    tax: 160,
    total: 1760,
  });
});

test('credits larger than the charge become a refund', () => {
  const sub = { plan: team, seats: 1, billing: 'monthly' as const, taxPct: 10 };
  expect(invoiceLabel(sub, [{ reason: 'outage', cents: 2500 }])).toBe('Refund 11.00');
});

test('bad seat counts are rejected', () => {
  const sub = { plan: team, seats: 0, billing: 'monthly' as const, taxPct: 0 };
  expect(() => periodInvoice(sub)).toThrow(RangeError);
});
