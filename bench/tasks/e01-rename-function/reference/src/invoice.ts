import { computeTotal } from './total.ts';
import type { Line } from './total.ts';

export function invoiceText(lines: Line[]): string {
  return `Total: ${computeTotal(lines).toFixed(2)}`;
}
