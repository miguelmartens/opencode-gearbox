import { expect, test } from 'bun:test';
import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';

const dir = process.env.WORK_DIR!;

test('computeTotal is exported and works', async () => {
  const mod = await import(join(dir, 'src/total.ts'));
  expect(mod.computeTotal([{ price: 2, qty: 3 }])).toBe(6);
  expect(mod.calcTotal).toBeUndefined();
});

test('invoice still works', async () => {
  const { invoiceText } = await import(join(dir, 'src/invoice.ts'));
  expect(invoiceText([{ price: 2.5, qty: 2 }])).toBe('Total: 5.00');
});

test('no calcTotal left in src', () => {
  for (const f of readdirSync(join(dir, 'src')))
    expect(readFileSync(join(dir, 'src', f), 'utf8')).not.toContain('calcTotal');
});
