import { expect, test } from 'bun:test';
import { join } from 'node:path';

const dir = process.env.WORK_DIR!;
const checkout = async () => (await import(join(dir, 'src/checkout.ts'))).checkoutTotal;

test('a $10 NY cart pays $0.80 tax', async () => {
  const checkoutTotal = await checkout();
  const r = checkoutTotal([{ sku: 'x', unitPrice: 10, qty: 1 }], 'NY');
  expect(r.subtotal).toBeCloseTo(10, 10);
  expect(r.tax).toBeCloseTo(0.8, 10);
  expect(r.shipping).toBeCloseTo(4.99, 10);
  expect(r.total).toBeCloseTo(15.79, 10);
});

test('multi-line TX cart with free shipping', async () => {
  const checkoutTotal = await checkout();
  const r = checkoutTotal(
    [
      { sku: 'a', unitPrice: 19.99, qty: 2 },
      { sku: 'b', unitPrice: 0.1, qty: 3 },
      { sku: 'c', unitPrice: 12.5, qty: 1 },
    ],
    'TX',
  );
  // 39.98 + 0.30 + 12.50 = 52.78; tax 3.29875 -> 3.30
  expect(r.subtotal).toBeCloseTo(52.78, 10);
  expect(r.tax).toBeCloseTo(3.3, 10);
  expect(r.shipping).toBe(0);
  expect(r.total).toBeCloseTo(56.08, 10);
});

test('tax-free region is unchanged', async () => {
  const checkoutTotal = await checkout();
  const r = checkoutTotal([{ sku: 'a', unitPrice: 7.25, qty: 4 }], 'OR');
  expect(r.tax).toBe(0);
  expect(r.total).toBeCloseTo(33.99, 10);
});

test('taxFor still takes and returns dollars', async () => {
  const { taxFor } = await import(join(dir, 'src/tax.ts'));
  expect(taxFor(10, 'NY')).toBeCloseTo(0.8, 10);
  expect(taxFor(250, 'TX')).toBeCloseTo(15.63, 10);
});
