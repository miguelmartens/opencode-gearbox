import { row } from './format.ts';

export type Region = 'DE' | 'FR' | 'US-CA' | 'US-OR';

/** Sales tax / VAT in percent. */
export const TAX_RATES: Record<Region, number> = { DE: 19, FR: 20, 'US-CA': 7.25, 'US-OR': 0 };

export type OrderItem = { sku: string; priceCents: number; quantity: number };

export type Order = {
  id: string;
  region: Region;
  items: OrderItem[];
  /** Coupon discount in percent, applied to the whole order. */
  couponPct?: number;
};

export type OrderTotals = { subtotal: number; discount: number; tax: number; total: number };

// Half away from zero, so a credit rounds like the matching charge.
function roundCents(value: number): number {
  return value < 0 ? -Math.round(-value) : Math.round(value);
}

export function orderTotals(order: Order): OrderTotals {
  if (order.items.length === 0) throw new Error(`order ${order.id} has no items`);
  const couponPct = order.couponPct ?? 0;
  if (couponPct < 0 || couponPct > 100) throw new RangeError(`bad coupon: ${couponPct}%`);

  let subtotal = 0;
  for (const item of order.items) subtotal += item.priceCents * item.quantity;
  const discount = roundCents((subtotal * couponPct) / 100);
  const taxable = subtotal - discount;
  const tax = roundCents((taxable * TAX_RATES[order.region]) / 100);
  return { subtotal, discount, tax, total: taxable + tax };
}

export function orderReceipt(order: Order): string {
  const totals = orderTotals(order);
  const lines = order.items.map((item) =>
    row(`${item.quantity} x ${item.sku}`, item.priceCents * item.quantity),
  );
  lines.push(row('Subtotal', totals.subtotal));
  if (totals.discount !== 0) lines.push(row(`Coupon (${order.couponPct}%)`, -totals.discount));
  lines.push(row(`Tax (${TAX_RATES[order.region]}%)`, totals.tax));
  lines.push(row('Total', totals.total));
  return lines.join('\n');
}
