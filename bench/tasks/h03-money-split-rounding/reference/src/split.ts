/**
 * Splits `totalCents` between people in proportion to their weights (nights stayed, seats, …).
 * Returns one share per weight, in the same order. The shares always add up to `totalCents`:
 * everyone gets the floor of their exact share, and the leftover cents go one each to the largest
 * remainders, ties to the lower index. A negative total is split like the positive one, negated.
 */
export function splitBill(totalCents: number, weights: number[]): number[] {
  if (!Number.isSafeInteger(totalCents)) {
    throw new RangeError(`total must be whole cents, got ${totalCents}`);
  }
  if (weights.length === 0) throw new RangeError('need at least one weight');
  for (const w of weights) {
    if (!Number.isSafeInteger(w) || w < 0) {
      throw new RangeError(`weights must be integers >= 0, got ${w}`);
    }
  }
  const totalWeight = weights.reduce((sum, w) => sum + w, 0);
  if (totalWeight === 0) throw new RangeError('weights must not all be zero');

  // `0 - s` keeps zero shares at +0.
  if (totalCents < 0) return splitBill(-totalCents, weights).map((s) => 0 - s);

  // Integer arithmetic: floor and remainder of totalCents * w / totalWeight.
  const shares = weights.map((w) => Math.floor((totalCents * w) / totalWeight));
  const remainders = weights.map((w) => (totalCents * w) % totalWeight);
  let leftover = totalCents - shares.reduce((sum, s) => sum + s, 0);
  const order = weights.map((_, i) => i).sort((a, b) => remainders[b]! - remainders[a]! || a - b);
  for (const i of order) {
    if (leftover === 0) break;
    shares[i]!++;
    leftover--;
  }
  return shares;
}

/** Splits `totalCents` evenly between `people`. */
export function splitEvenly(totalCents: number, people: number): number[] {
  return splitBill(
    totalCents,
    Array.from({ length: people }, () => 1),
  );
}
