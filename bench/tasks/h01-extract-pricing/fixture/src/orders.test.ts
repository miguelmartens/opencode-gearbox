import { expect, test } from 'bun:test';
import { orderReceipt, orderTotals } from './orders.ts';

test('order totals with coupon and tax', () => {
  const totals = orderTotals({
    id: 'o-1',
    region: 'DE',
    items: [
      { sku: 'mug', priceCents: 1200, quantity: 2 },
      { sku: 'tee', priceCents: 1999, quantity: 1 },
    ],
    couponPct: 10,
  });
  expect(totals).toEqual({ subtotal: 4399, discount: 440, tax: 752, total: 4711 });
});

test('empty orders are rejected', () => {
  expect(() => orderTotals({ id: 'o-2', region: 'FR', items: [] })).toThrow('no items');
});

test('bad coupons are rejected', () => {
  const items = [{ sku: 'cap', priceCents: 850, quantity: 1 }];
  expect(() => orderTotals({ id: 'o-3', region: 'FR', items, couponPct: 120 })).toThrow(RangeError);
});

test('receipt lists items and totals', () => {
  const text = orderReceipt({
    id: 'o-4',
    region: 'US-OR',
    items: [{ sku: 'cap', priceCents: 850, quantity: 2 }],
    couponPct: 50,
  });
  expect(text.split('\n')).toEqual([
    '2 x cap                17.00',
    'Subtotal               17.00',
    'Coupon (50%)           -8.50',
    'Tax (0%)                0.00',
    'Total                   8.50',
  ]);
});
