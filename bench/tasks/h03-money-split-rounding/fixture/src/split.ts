import { roundCents } from './money.ts';

/**
 * Splits `totalCents` between people in proportion to their weights (nights stayed, seats, …).
 * Returns one share per weight, in the same order.
 */
export function splitBill(totalCents: number, weights: number[]): number[] {
  const totalWeight = weights.reduce((sum, w) => sum + w, 0);
  return weights.map((w) => roundCents((totalCents * w) / totalWeight));
}

/** Splits `totalCents` evenly between `people`. */
export function splitEvenly(totalCents: number, people: number): number[] {
  return splitBill(
    totalCents,
    Array.from({ length: people }, () => 1),
  );
}
