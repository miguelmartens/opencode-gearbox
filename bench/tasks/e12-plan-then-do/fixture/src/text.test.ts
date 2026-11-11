import { expect, test } from 'bun:test';
import { collapseSpaces, slugify } from './text.ts';

test('collapseSpaces', () => {
  expect(collapseSpaces('a  b\n\tc')).toBe('a b c');
});

test('slugify', () => {
  expect(slugify('  Hello, World! ')).toBe('hello-world');
});
