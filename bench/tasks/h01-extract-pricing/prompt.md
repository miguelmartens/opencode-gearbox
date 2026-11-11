We have three copies of the same discount + tax + rounding maths: `orderTotals` in `src/orders.ts`, `quoteTotals` in `src/quotes.ts` and `periodInvoice` in `src/subscriptions.ts`. They have drifted apart, and I think at least one of them rounds wrong. I want a single shared implementation.

Before you edit anything, use a subagent (the task tool) to map the three copies: what each one computes, how and where it rounds, and every place where they differ. Then tell me which copy is correct and propose the shared API. Don't change code in this step.

The shared module should be `src/pricing.ts` and export roughly this:

```ts
export type PriceLine = { unitCents: number; qty: number };
export type PriceOptions = { discountPct?: number; taxPct?: number };
export type PriceBreakdown = { subtotal: number; discount: number; tax: number; total: number };
export function priceLines(lines: PriceLine[], opts?: PriceOptions): PriceBreakdown;
```

Semantics, all amounts in integer cents:

- `subtotal` is the sum of `unitCents * qty`. Lines can be negative (credits), so the subtotal can be negative.
- `discount` is `discountPct` percent of the whole subtotal, rounded once on the subtotal, never per line.
- `tax` is `taxPct` percent of `subtotal - discount`, rounded once.
- `total` is `subtotal - discount + tax`.
- Rounding is half away from zero (2.5 → 3, −2.5 → −3), so a credit rounds exactly like the matching charge.
- Both percentages default to 0. Throw a `RangeError` when `discountPct` is outside 0–100 or `taxPct` is negative.

When it's done, `orders.ts`, `quotes.ts` and `subscriptions.ts` must all call `priceLines` and keep no rounding or percentage maths of their own. Their exported functions keep their names and signatures, and the existing tests must keep passing.

---

ok, continue
