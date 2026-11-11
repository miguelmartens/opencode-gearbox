export const SYMBOLS: Record<string, string> = { EUR: '€', USD: '$', GBP: '£' };

/** Rounds to whole cents, half away from zero, so -0.5 rounds like 0.5. */
export function roundCents(value: number): number {
  return (value < 0 ? -Math.round(-value) : Math.round(value)) + 0;
}

/** Formats integer cents for display, e.g. formatMoney(1234) -> "€12.34", -5 -> "-€0.05". */
export function formatMoney(cents: number, currency = 'EUR'): string {
  const symbol = SYMBOLS[currency] ?? `${currency} `;
  const sign = cents < 0 ? '-' : '';
  const abs = Math.abs(cents);
  const units = Math.floor(abs / 100);
  const rest = String(abs % 100).padStart(2, '0');
  return `${sign}${symbol}${units}.${rest}`;
}

export function sumCents(amounts: number[]): number {
  return amounts.reduce((sum, cents) => sum + cents, 0);
}
