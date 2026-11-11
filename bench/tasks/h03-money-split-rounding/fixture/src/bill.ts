import { formatMoney, sumCents } from './money.ts';
import { splitBill } from './split.ts';

export type Diner = { name: string; weight: number };

export type Settlement = {
  shares: Array<{ name: string; cents: number }>;
  /** Sum of the shares; should always equal the bill. */
  totalCents: number;
};

/** Who owes what. A negative `totalCents` is a refund paid back to the diners. */
export function settle(totalCents: number, diners: Diner[]): Settlement {
  const amounts = splitBill(
    totalCents,
    diners.map((d) => d.weight),
  );
  return {
    shares: diners.map((d, i) => ({ name: d.name, cents: amounts[i]! })),
    totalCents: sumCents(amounts),
  };
}

/** One line per diner, then the total, e.g. "Ana: €12.50". */
export function describeSplit(totalCents: number, diners: Diner[], currency = 'EUR'): string {
  const { shares, totalCents: sum } = settle(totalCents, diners);
  const lines = shares.map((s) => `${s.name}: ${formatMoney(s.cents, currency)}`);
  lines.push(`Total: ${formatMoney(sum, currency)}`);
  return lines.join('\n');
}
