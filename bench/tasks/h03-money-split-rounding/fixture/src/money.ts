export const SYMBOLS: Record<string, string> = { EUR: '€', USD: '$', GBP: '£' };

/** Rounds to whole cents. */
export function roundCents(value: number): number {
  return Math.round(value);
}

/** Formats integer cents for display, e.g. formatMoney(1234) -> "€12.34". */
export function formatMoney(cents: number, currency = 'EUR'): string {
  const symbol = SYMBOLS[currency] ?? `${currency} `;
  const units = Math.trunc(cents / 100);
  const rest = String(Math.abs(cents % 100)).padStart(2, '0');
  return `${symbol}${units}.${rest}`;
}

export function sumCents(amounts: number[]): number {
  return amounts.reduce((sum, cents) => sum + cents, 0);
}
