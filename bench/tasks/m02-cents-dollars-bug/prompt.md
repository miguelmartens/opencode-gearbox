Customers are being overcharged on tax. The tax on a $10 cart in NY comes out as $80 instead of $0.80, and the total is way off too. Tax-free regions look fine.

The checkout entry point is `checkoutTotal(items, region)` in `src/checkout.ts`, and the cart maths is in `src/cart.ts`. Find the cause and fix it, and add a regression test.
