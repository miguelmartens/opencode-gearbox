import { expect, test } from 'bun:test';
import { checkoutTotal } from './checkout.ts';

test('tax-free region pays subtotal plus shipping', () => {
  expect(checkoutTotal([{ sku: 'a', unitPrice: 0.1, qty: 3 }], 'OR')).toEqual({
    subtotal: 0.3,
    tax: 0,
    shipping: 4.99,
    total: 5.29,
  });
});

test('tax is charged on the dollar subtotal', () => {
  expect(checkoutTotal([{ sku: 'c', unitPrice: 10, qty: 1 }], 'NY')).toEqual({
    subtotal: 10,
    tax: 0.8,
    shipping: 4.99,
    total: 15.79,
  });
});

test('shipping is free from $50', () => {
  expect(checkoutTotal([{ sku: 'b', unitPrice: 25, qty: 2 }], 'OR').shipping).toBe(0);
});

test('empty cart costs nothing', () => {
  expect(checkoutTotal([], 'NY').total).toBe(0);
});
