export type Region = 'NY' | 'TX' | 'OR';

const RATES: Record<Region, number> = { NY: 0.08, TX: 0.0625, OR: 0 };

export function taxRate(region: Region): number {
  return RATES[region];
}

/** Sales tax in dollars for an amount in dollars, rounded to the cent. */
export function taxFor(amount: number, region: Region): number {
  return Math.round(amount * taxRate(region) * 100) / 100;
}
