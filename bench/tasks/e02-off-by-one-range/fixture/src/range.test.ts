import { expect, test } from 'bun:test';
import { range } from './range.ts';
import { pageNumbers } from './pages.ts';

test('range includes both ends', () => {
  expect(range(1, 3)).toEqual([1, 2, 3]);
});

test('no pages for no items', () => {
  expect(pageNumbers(0, 10)).toEqual([]);
});
