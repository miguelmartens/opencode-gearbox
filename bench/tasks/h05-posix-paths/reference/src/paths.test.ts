import { expect, test } from 'bun:test';
import { basename, dirname, join, normalize, relative } from './paths.ts';

test('normalize collapses dots and slashes', () => {
  expect(normalize('/a//b/./c/../d')).toBe('/a/b/d');
  expect(normalize('a/b/../c')).toBe('a/c');
});

test('normalize keeps leading .. of relative paths and trailing slashes', () => {
  expect(normalize('../a')).toBe('../a');
  expect(normalize('a/..')).toBe('.');
  expect(normalize('a/../')).toBe('./');
  expect(normalize('')).toBe('.');
  expect(normalize('/..')).toBe('/');
  expect(normalize('a/b/')).toBe('a/b/');
});

test('join joins and normalizes', () => {
  expect(join('/a', 'b', '../c')).toBe('/a/c');
  expect(join('a', 'b')).toBe('a/b');
  expect(join()).toBe('.');
  expect(join('', '')).toBe('.');
  expect(join('a', '', 'b/')).toBe('a/b/');
});

test('relative walks up and down', () => {
  expect(relative('/a/b/c', '/a/d')).toBe('../../d');
  expect(relative('/a', '/a/b/c')).toBe('b/c');
  expect(relative('/a', '/a')).toBe('');
  expect(relative('/', '/a')).toBe('a');
  expect(relative('/a/b', '/')).toBe('../..');
  expect(relative('/ab', '/a')).toBe('../a');
});

test('dirname and basename split the last segment', () => {
  expect(dirname('/a/b/c.txt')).toBe('/a/b');
  expect(basename('/a/b/c.txt')).toBe('c.txt');
  expect(dirname('/a/b/')).toBe('/a');
  expect(basename('/a/b/')).toBe('b');
  expect(dirname('a')).toBe('.');
  expect(dirname('//a')).toBe('//');
  expect(basename('/')).toBe('');
});
