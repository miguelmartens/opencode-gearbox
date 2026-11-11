import { calcTotal } from './total.ts';
import type { Line } from './total.ts';

export function invoiceText(lines: Line[]): string {
  return `Total: ${calcTotal(lines).toFixed(2)}`;
}
