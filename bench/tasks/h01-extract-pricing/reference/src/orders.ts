import { row } from './format.ts';
import { priceLines } from './pricing.ts';
import type { PriceBreakdown } from './pricing.ts';

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

export type OrderTotals = PriceBreakdown;

export function orderTotals(order: Order): OrderTotals {
  if (order.items.length === 0) throw new Error(`order ${order.id} has no items`);
  return priceLines(
    order.items.map((item) => ({ unitCents: item.priceCents, qty: item.quantity })),
    { discountPct: order.couponPct ?? 0, taxPct: TAX_RATES[order.region] },
  );
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
