import { taxFor } from './tax.ts';
import type { Region } from './tax.ts';

export type Item = { sku: string; unitPrice: number; qty: number };

export type CartSummary = { subtotal: number; tax: number };

/** Subtotal in integer cents, so float prices like 0.1 add up exactly. */
export function subtotalCents(items: Item[]): number {
  return items.reduce((sum, item) => sum + Math.round(item.unitPrice * 100) * item.qty, 0);
}

/** Subtotal and tax for the cart, both in dollars. */
export function cartSummary(items: Item[], region: Region): CartSummary {
  const cents = subtotalCents(items);
  return { subtotal: cents / 100, tax: taxFor(cents, region) };
}
