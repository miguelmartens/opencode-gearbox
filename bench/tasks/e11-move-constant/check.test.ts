import { expect, test } from 'bun:test';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

const dir = process.env.WORK_DIR!;
const items = Array.from({ length: 100 }, (_, i) => i);

/** Source without comments, so doc comments may still mention the number. */
function code(file: string): string {
  return readFileSync(join(dir, 'src', file), 'utf8')
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .replace(/\/\/.*$/gm, '');
}

test('config exports MAX_PAGE_SIZE = 30', async () => {
  const { MAX_PAGE_SIZE } = await import(join(dir, 'src/config.ts'));
  expect(MAX_PAGE_SIZE).toBe(30);
});

test('both modules use the constant instead of the literal', () => {
  for (const f of ['pager.ts', 'api.ts']) {
    const src = code(f);
    expect(src).not.toMatch(/\b30\b/);
    expect(src).toContain('MAX_PAGE_SIZE');
    expect(src).toMatch(/from ['"]\.\/config(\.ts)?['"]/);
  }
});

test('paginate behaves as before', async () => {
  const { paginate } = await import(join(dir, 'src/pager.ts'));
  expect(paginate(items, 1, 3)).toEqual([0, 1, 2]);
  expect(paginate(items, 2, 50)).toEqual(items.slice(30, 60));
  expect(paginate(items, 4, 30)).toEqual(items.slice(90, 100));
  expect(paginate(items, 0, 0)).toEqual([0]);
  expect(paginate(items, 9, 30)).toEqual([]);
});

test('parseLimit behaves as before', async () => {
  const { parseLimit } = await import(join(dir, 'src/api.ts'));
  expect(parseLimit(undefined)).toBe(30);
  expect(parseLimit('')).toBe(30);
  expect(parseLimit('abc')).toBe(30);
  expect(parseLimit('31')).toBe(30);
  expect(parseLimit('30')).toBe(30);
  expect(parseLimit('12')).toBe(12);
  expect(parseLimit('0')).toBe(1);
  expect(parseLimit('-5')).toBe(1);
});
