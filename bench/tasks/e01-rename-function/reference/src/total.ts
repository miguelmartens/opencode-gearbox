export type Line = { price: number; qty: number };

/** Sum of price × quantity over all lines. */
export function computeTotal(lines: Line[]): number {
  return lines.reduce((sum, line) => sum + line.price * line.qty, 0);
}
