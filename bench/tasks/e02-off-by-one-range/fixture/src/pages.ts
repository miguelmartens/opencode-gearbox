import { range } from './range.ts';

/** Page numbers 1..n needed to show `total` items, `perPage` at a time. */
export function pageNumbers(total: number, perPage: number): number[] {
  return range(1, Math.ceil(total / perPage));
}
