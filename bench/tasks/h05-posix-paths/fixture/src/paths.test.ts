import { expect, test } from 'bun:test';
import { basename, dirname, join, normalize, relative } from './paths.ts';

test('normalize collapses dots and slashes', () => {
  expect(normalize('/a//b/./c/../d')).toBe('/a/b/d');
  expect(normalize('a/b/../c')).toBe('a/c');
});

test('join joins and normalizes', () => {
  expect(join('/a', 'b', '../c')).toBe('/a/c');
  expect(join('a', 'b')).toBe('a/b');
});

test('relative walks up and down', () => {
  expect(relative('/a/b/c', '/a/d')).toBe('../../d');
  expect(relative('/a', '/a/b/c')).toBe('b/c');
});

test('dirname and basename split the last segment', () => {
  expect(dirname('/a/b/c.txt')).toBe('/a/b');
  expect(basename('/a/b/c.txt')).toBe('c.txt');
});
