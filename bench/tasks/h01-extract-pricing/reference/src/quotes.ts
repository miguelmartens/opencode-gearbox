import { formatCents } from './format.ts';
import { priceLines } from './pricing.ts';
import type { PriceBreakdown } from './pricing.ts';

export type QuoteLine = { description: string; rateCents: number; hours: number };

export type Quote = {
  client: string;
  lines: QuoteLine[];
  discountPct: number;
  taxPct: number;
};

export type QuoteTotals = PriceBreakdown;

export function quoteTotals(quote: Quote): QuoteTotals {
  return priceLines(
    quote.lines.map((line) => ({ unitCents: line.rateCents, qty: line.hours })),
    { discountPct: quote.discountPct, taxPct: quote.taxPct },
  );
}

export function quoteSummary(quote: Quote): string {
  const t = quoteTotals(quote);
  const hours = quote.lines.reduce((sum, line) => sum + line.hours, 0);
  return `Quote for ${quote.client}: ${hours}h, ${formatCents(t.total)} incl. ${formatCents(t.tax)} tax`;
}
