import { expect, test } from 'bun:test';
import { PRODUCTS } from './products.ts';
import { searchProducts } from './search.ts';

test('filters by tag and sorts by name', () => {
  expect(searchProducts(PRODUCTS, { tag: 'home' }).map((p) => p.id)).toEqual(['p6', 'p1', 'p4']);
});

test('filters by query and max price', () => {
  expect(searchProducts(PRODUCTS, { query: 'o', maxPrice: 10 }).map((p) => p.id)).toEqual(['p2']);
});

test('no options returns everything', () => {
  expect(searchProducts(PRODUCTS)).toHaveLength(PRODUCTS.length);
});
