import { cartSummary } from './cart.ts';
import type { Item } from './cart.ts';
import type { Region } from './tax.ts';

export const FREE_SHIPPING_FROM = 50;
export const SHIPPING_FEE = 4.99;

export type Totals = { subtotal: number; tax: number; shipping: number; total: number };

/** Everything the customer pays, in dollars. */
export function checkoutTotal(items: Item[], region: Region): Totals {
  const { subtotal, tax } = cartSummary(items, region);
  const shipping = items.length === 0 || subtotal >= FREE_SHIPPING_FROM ? 0 : SHIPPING_FEE;
  const total = Math.round((subtotal + tax + shipping) * 100) / 100;
  return { subtotal, tax, shipping, total };
}
