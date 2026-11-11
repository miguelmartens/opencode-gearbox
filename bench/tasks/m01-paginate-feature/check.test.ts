import { expect, test } from 'bun:test';
import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';

const dir = process.env.WORK_DIR!;
const load = async () => (await import(join(dir, 'src/paginate.ts'))).paginate;
const ten = Array.from({ length: 10 }, (_, i) => i + 1);

test('middle and last pages', async () => {
  const paginate = await load();
  expect(paginate(ten, 1, 4)).toEqual({
    items: [1, 2, 3, 4],
    page: 1,
    totalPages: 3,
    hasNext: true,
  });
  expect(paginate(ten, 2, 4)).toEqual({
    items: [5, 6, 7, 8],
    page: 2,
    totalPages: 3,
    hasNext: true,
  });
  expect(paginate(ten, 3, 4)).toEqual({ items: [9, 10], page: 3, totalPages: 3, hasNext: false });
});

test('exact fit has no next page', async () => {
  const paginate = await load();
  expect(paginate(ten, 2, 5)).toEqual({
    items: [6, 7, 8, 9, 10],
    page: 2,
    totalPages: 2,
    hasNext: false,
  });
  expect(paginate(ten, 1, 10).hasNext).toBe(false);
  expect(paginate(ten, 1, 50)).toEqual({ items: ten, page: 1, totalPages: 1, hasNext: false });
});

test('page below 1 clamps to 1', async () => {
  const paginate = await load();
  expect(paginate(ten, 0, 3)).toEqual({ items: [1, 2, 3], page: 1, totalPages: 4, hasNext: true });
  expect(paginate(ten, -5, 3).page).toBe(1);
});

test('page past the end is empty', async () => {
  const paginate = await load();
  const r = paginate(ten, 7, 3);
  expect(r.items).toEqual([]);
  expect(r.totalPages).toBe(4);
  expect(r.hasNext).toBe(false);
});

test('empty input', async () => {
  const paginate = await load();
  expect(paginate([], 1, 5)).toEqual({ items: [], page: 1, totalPages: 0, hasNext: false });
});

test('size must be > 0', async () => {
  const paginate = await load();
  expect(() => paginate(ten, 1, 0)).toThrow(RangeError);
  expect(() => paginate(ten, 1, -3)).toThrow(RangeError);
});

test('does not mutate input', async () => {
  const paginate = await load();
  const copy = [...ten];
  paginate(ten, 2, 3);
  expect(ten).toEqual(copy);
});

test('src/paginate.test.ts exists and imports paginate', () => {
  const file = join(dir, 'src/paginate.test.ts');
  expect(existsSync(file)).toBe(true);
  const src = readFileSync(file, 'utf8');
  expect(src).toMatch(/import\s*\{[^}]*\bpaginate\b[^}]*\}\s*from\s*['"]\.\/paginate(\.ts)?['"]/);
  expect(src).toContain('bun:test');
  expect((src.match(/\btest\(|\bit\(/g) ?? []).length).toBeGreaterThanOrEqual(2);
});
