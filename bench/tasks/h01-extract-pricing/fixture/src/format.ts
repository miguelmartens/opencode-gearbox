/** Formats integer cents as a decimal amount, e.g. 1234 -> "12.34", -5 -> "-0.05". */
export function formatCents(cents: number): string {
  const sign = cents < 0 ? '-' : '';
  const abs = Math.abs(cents);
  const units = Math.floor(abs / 100);
  const rest = String(abs % 100).padStart(2, '0');
  return `${sign}${units}.${rest}`;
}

/** A label padded to a fixed width followed by a right-aligned amount. */
export function row(label: string, cents: number, width = 28): string {
  const amount = formatCents(cents);
  return label.padEnd(width - amount.length, ' ') + amount;
}
