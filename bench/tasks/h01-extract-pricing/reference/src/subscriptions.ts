import { formatCents } from './format.ts';
import { priceLines } from './pricing.ts';
import type { PriceBreakdown } from './pricing.ts';

export type Plan = { name: string; seatCents: number; annualDiscountPct: number };

export type Subscription = {
  plan: Plan;
  seats: number;
  billing: 'monthly' | 'annual';
  taxPct: number;
};

/** A one-off credit (proration, goodwill) taken off the next invoice. Positive cents. */
export type Credit = { reason: string; cents: number };

export type InvoiceTotals = PriceBreakdown;

export function periodInvoice(sub: Subscription, credits: Credit[] = []): InvoiceTotals {
  if (!Number.isInteger(sub.seats) || sub.seats < 1) {
    throw new RangeError(`bad seat count: ${sub.seats}`);
  }
  const lines = [
    { unitCents: sub.plan.seatCents, qty: sub.seats },
    ...credits.map((credit) => ({ unitCents: -credit.cents, qty: 1 })),
  ];
  return priceLines(lines, {
    discountPct: sub.billing === 'annual' ? sub.plan.annualDiscountPct : 0,
    taxPct: sub.taxPct,
  });
}

/** "Refund 12.34" when credits exceed the charge, otherwise "Charge 12.34". */
export function invoiceLabel(sub: Subscription, credits: Credit[] = []): string {
  const { total } = periodInvoice(sub, credits);
  return total < 0 ? `Refund ${formatCents(-total)}` : `Charge ${formatCents(total)}`;
}
