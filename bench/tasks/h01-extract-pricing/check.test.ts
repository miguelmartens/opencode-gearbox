import { describe, expect, test } from 'bun:test';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

const dir = process.env.WORK_DIR!;
const load = (name: string) => import(join(dir, 'src', name));

describe('priceLines', () => {
  test('empty input and default options', async () => {
    const { priceLines } = await load('pricing.ts');
    expect(priceLines([])).toEqual({ subtotal: 0, discount: 0, tax: 0, total: 0 });
    expect(priceLines([{ unitCents: 250, qty: 4 }])).toEqual({
      subtotal: 1000,
      discount: 0,
      tax: 0,
      total: 1000,
    });
  });

  test('discount rounds once on the subtotal, not per line', async () => {
    const { priceLines } = await load('pricing.ts');
    const lines = [0, 1, 2].map(() => ({ unitCents: 1005, qty: 1 }));
    expect(priceLines(lines, { discountPct: 10 })).toEqual({
      subtotal: 3015,
      discount: 302,
      tax: 0,
      total: 2713,
    });
  });

  test('tax applies after the discount, with fractional rates', async () => {
    const { priceLines } = await load('pricing.ts');
    expect(priceLines([{ unitCents: 1000, qty: 3 }], { taxPct: 7.25 })).toEqual({
      subtotal: 3000,
      discount: 0,
      tax: 218,
      total: 3218,
    });
    expect(
      priceLines(
        [
          { unitCents: 1200, qty: 2 },
          { unitCents: 1999, qty: 1 },
        ],
        { discountPct: 10, taxPct: 19 },
      ),
    ).toEqual({ subtotal: 4399, discount: 440, tax: 752, total: 4711 });
  });

  test('negative amounts round half away from zero', async () => {
    const { priceLines } = await load('pricing.ts');
    expect(priceLines([{ unitCents: -250, qty: 1 }], { taxPct: 1 })).toEqual({
      subtotal: -250,
      discount: 0,
      tax: -3,
      total: -253,
    });
    expect(priceLines([{ unitCents: -1005, qty: 1 }], { discountPct: 10 })).toEqual({
      subtotal: -1005,
      discount: -101,
      tax: 0,
      total: -904,
    });
    expect(
      priceLines(
        [
          { unitCents: 1000, qty: 1 },
          { unitCents: -625, qty: 2 },
        ],
        { discountPct: 10, taxPct: 2 },
      ),
    ).toEqual({ subtotal: -250, discount: -25, tax: -5, total: -230 });
  });

  test('a full discount leaves nothing to tax', async () => {
    const { priceLines } = await load('pricing.ts');
    expect(priceLines([{ unitCents: 500, qty: 1 }], { discountPct: 100, taxPct: 20 })).toEqual({
      subtotal: 500,
      discount: 500,
      tax: 0,
      total: 0,
    });
  });

  test('out-of-range percentages throw RangeError', async () => {
    const { priceLines } = await load('pricing.ts');
    const lines = [{ unitCents: 100, qty: 1 }];
    expect(() => priceLines(lines, { discountPct: -1 })).toThrow(RangeError);
    expect(() => priceLines(lines, { discountPct: 100.5 })).toThrow(RangeError);
    expect(() => priceLines(lines, { taxPct: -0.5 })).toThrow(RangeError);
    expect(() => priceLines(lines, { discountPct: 0, taxPct: 0 })).not.toThrow();
  });

  test('does not mutate its input', async () => {
    const { priceLines } = await load('pricing.ts');
    const lines = [{ unitCents: 1005, qty: 2 }];
    const opts = { discountPct: 10, taxPct: 5 };
    priceLines(lines, opts);
    expect(lines).toEqual([{ unitCents: 1005, qty: 2 }]);
    expect(opts).toEqual({ discountPct: 10, taxPct: 5 });
  });
});

describe('callers keep their (correct) behaviour', () => {
  test('orders', async () => {
    const { orderTotals, orderReceipt } = await load('orders.ts');
    const items = [{ sku: 'pen', priceCents: 1005, quantity: 3 }];
    expect(orderTotals({ id: 'a', region: 'US-OR', items, couponPct: 10 })).toEqual({
      subtotal: 3015,
      discount: 302,
      tax: 0,
      total: 2713,
    });
    expect(
      orderTotals({
        id: 'b',
        region: 'US-CA',
        items: [{ sku: 'x', priceCents: 1000, quantity: 3 }],
      }),
    ).toEqual({ subtotal: 3000, discount: 0, tax: 218, total: 3218 });
    expect(() => orderTotals({ id: 'c', region: 'DE', items: [] })).toThrow('no items');
    expect(() => orderTotals({ id: 'd', region: 'DE', items, couponPct: 101 })).toThrow(RangeError);
    expect(orderReceipt({ id: 'e', region: 'FR', items, couponPct: 10 }).split('\n')).toEqual([
      '3 x pen                30.15',
      'Subtotal               30.15',
      'Coupon (10%)           -3.02',
      'Tax (20%)               5.43',
      'Total                  32.56',
    ]);
  });

  test('quotes round the discount on the total', async () => {
    const { quoteTotals, quoteSummary } = await load('quotes.ts');
    const quote = {
      client: 'Initech',
      lines: [0, 1, 2].map((i) => ({ description: `task ${i}`, rateCents: 1005, hours: 1 })),
      discountPct: 10,
      taxPct: 0,
    };
    expect(quoteTotals(quote)).toEqual({ subtotal: 3015, discount: 302, tax: 0, total: 2713 });
    expect(quoteSummary({ ...quote, taxPct: 20 })).toBe(
      'Quote for Initech: 3h, 32.56 incl. 5.43 tax',
    );
    expect(quoteTotals({ client: 'none', lines: [], discountPct: 0, taxPct: 0 })).toEqual({
      subtotal: 0,
      discount: 0,
      tax: 0,
      total: 0,
    });
  });

  test('subscriptions round credits like charges', async () => {
    const { periodInvoice, invoiceLabel } = await load('subscriptions.ts');
    const plan = { name: 'Solo', seatCents: 1000, annualDiscountPct: 10 };
    const monthly = { plan, seats: 1, billing: 'monthly', taxPct: 1 };
    const credit = [{ reason: 'outage', cents: 1250 }];
    expect(periodInvoice(monthly, credit)).toEqual({
      subtotal: -250,
      discount: 0,
      tax: -3,
      total: -253,
    });
    expect(invoiceLabel(monthly, credit)).toBe('Refund 2.53');

    const annual = { plan: { ...plan, seatCents: 995 }, seats: 1, billing: 'annual', taxPct: 0 };
    expect(periodInvoice(annual, [{ reason: 'move', cents: 2000 }])).toEqual({
      subtotal: -1005,
      discount: -101,
      tax: 0,
      total: -904,
    });
    expect(invoiceLabel(annual)).toBe('Charge 8.95');
    expect(() => periodInvoice({ ...monthly, seats: 1.5 })).toThrow(RangeError);
  });
});

describe('one shared implementation', () => {
  for (const name of ['orders.ts', 'quotes.ts', 'subscriptions.ts']) {
    test(`${name} uses priceLines and has no pricing maths of its own`, () => {
      const src = readFileSync(join(dir, 'src', name), 'utf8');
      expect(src).toMatch(
        /import\s*\{[^}]*\bpriceLines\b[^}]*\}\s*from\s*['"]\.\/pricing(\.ts)?['"]/,
      );
      expect(src).toContain('priceLines(');
      expect(src).not.toMatch(/Math\.(round|floor|ceil|trunc)/);
      expect(src).not.toMatch(/\/\s*100\b/);
    });
  }
});
