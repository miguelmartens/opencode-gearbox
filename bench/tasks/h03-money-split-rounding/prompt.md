Our bill splitter loses and invents cents. `splitBill(totalCents, weights)` in `src/split.ts` splits €1.00 three ways as 33 + 33 + 33 cents, so a cent disappears, and €1.01 between two people comes out as 51 + 51. Refunds (negative totals) are worse: a −€1.01 refund split two ways gives −50 and −50, and `formatMoney` in `src/money.ts` prints those shares as "€0.50", without the minus. `describeSplit` and `settle` in `src/bill.ts` show all of this to users.

Fix it so that:

- `splitBill(totalCents, weights)` returns one integer share per weight, in order, and the shares always add up to exactly `totalCents`. Use largest-remainder allocation: everyone gets the floor of their exact share `totalCents * w / sum(weights)`, then the leftover cents go one each to the largest fractional remainders, ties broken by the lower index. So `splitBill(100, [1, 1, 1])` is `[34, 33, 33]` and `splitBill(10, [3, 3, 1])` is `[4, 4, 2]`.
- Negative totals are symmetric: `splitBill(-t, w)` is exactly the negation of `splitBill(t, w)`.
- Weights are non-negative integers. Throw a `RangeError` for an empty weights list, all-zero weights, a negative or non-integer weight, or a total that isn't whole cents. `splitEvenly` follows the same rules.
- `formatMoney` puts the minus sign before the currency symbol: `formatMoney(-5)` is `"-€0.05"` and `formatMoney(-105)` is `"-€1.05"`. Positive amounts format as before.

Add tests for the cases above.
