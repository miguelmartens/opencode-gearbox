export type PriceLine = { unitCents: number; qty: number };

export type PriceOptions = {
  /** Discount in percent (0–100) on the subtotal. Default 0. */
  discountPct?: number;
  /** Tax in percent (≥ 0) on the subtotal after discount. Default 0. */
  taxPct?: number;
};

export type PriceBreakdown = { subtotal: number; discount: number; tax: number; total: number };

/** Rounds to whole cents, half away from zero, so a credit rounds like the matching charge. */
export function roundCents(value: number): number {
  // `+ 0` turns -0 into 0.
  return (value < 0 ? -Math.round(-value) : Math.round(value)) + 0;
}

/**
 * Prices a list of lines: subtotal, then a discount on the whole subtotal, then tax on what is left.
 * Rounds once per amount (never per line), half away from zero.
 */
export function priceLines(lines: PriceLine[], opts: PriceOptions = {}): PriceBreakdown {
  const discountPct = opts.discountPct ?? 0;
  const taxPct = opts.taxPct ?? 0;
  if (!(discountPct >= 0 && discountPct <= 100)) {
    throw new RangeError(`discount must be 0-100%, got ${discountPct}%`);
  }
  if (!(taxPct >= 0)) throw new RangeError(`tax must be >= 0%, got ${taxPct}%`);

  let subtotal = 0;
  for (const line of lines) subtotal += line.unitCents * line.qty;
  const discount = roundCents((subtotal * discountPct) / 100);
  const taxable = subtotal - discount;
  const tax = roundCents((taxable * taxPct) / 100);
  return { subtotal, discount, tax, total: taxable + tax };
}
