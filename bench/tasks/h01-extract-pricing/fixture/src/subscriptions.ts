import { formatCents } from './format.ts';

export type Plan = { name: string; seatCents: number; annualDiscountPct: number };

export type Subscription = {
  plan: Plan;
  seats: number;
  billing: 'monthly' | 'annual';
  taxPct: number;
};

/** A one-off credit (proration, goodwill) taken off the next invoice. Positive cents. */
export type Credit = { reason: string; cents: number };

export type InvoiceTotals = { subtotal: number; discount: number; tax: number; total: number };

export function periodInvoice(sub: Subscription, credits: Credit[] = []): InvoiceTotals {
  if (!Number.isInteger(sub.seats) || sub.seats < 1) {
    throw new RangeError(`bad seat count: ${sub.seats}`);
  }
  let subtotal = sub.plan.seatCents * sub.seats;
  for (const credit of credits) subtotal -= credit.cents;

  const discountPct = sub.billing === 'annual' ? sub.plan.annualDiscountPct : 0;
  const discount = Math.round((subtotal * discountPct) / 100);
  const taxable = subtotal - discount;
  const tax = Math.round((taxable * sub.taxPct) / 100);
  return { subtotal, discount, tax, total: taxable + tax };
}

/** "Refund 12.34" when credits exceed the charge, otherwise "Charge 12.34". */
export function invoiceLabel(sub: Subscription, credits: Credit[] = []): string {
  const { total } = periodInvoice(sub, credits);
  return total < 0 ? `Refund ${formatCents(-total)}` : `Charge ${formatCents(total)}`;
}
