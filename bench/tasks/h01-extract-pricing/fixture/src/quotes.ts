import { formatCents } from './format.ts';

export type QuoteLine = { description: string; rateCents: number; hours: number };

export type Quote = {
  client: string;
  lines: QuoteLine[];
  discountPct: number;
  taxPct: number;
};

export type QuoteTotals = { subtotal: number; discount: number; tax: number; total: number };

export function quoteTotals(quote: Quote): QuoteTotals {
  let subtotal = 0;
  let discount = 0;
  for (const line of quote.lines) {
    const amount = line.rateCents * line.hours;
    subtotal += amount;
    discount += Math.round((amount * quote.discountPct) / 100);
  }
  const taxable = subtotal - discount;
  const tax = Math.round((taxable * quote.taxPct) / 100);
  return { subtotal, discount, tax, total: taxable + tax };
}

export function quoteSummary(quote: Quote): string {
  const t = quoteTotals(quote);
  const hours = quote.lines.reduce((sum, line) => sum + line.hours, 0);
  return `Quote for ${quote.client}: ${hours}h, ${formatCents(t.total)} incl. ${formatCents(t.tax)} tax`;
}
