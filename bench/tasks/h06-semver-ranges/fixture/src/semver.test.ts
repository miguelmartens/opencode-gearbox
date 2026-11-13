import { expect, test } from 'bun:test';
import { compare, parse, satisfies } from './semver.ts';
import { brokenDeps, maxSatisfying } from './deps.ts';

test('parse reads versions', () => {
  expect(parse('1.2.3')).toEqual({ major: 1, minor: 2, patch: 3, prerelease: [] });
  expect(parse('1.2.3-beta.1')?.prerelease).toEqual(['beta', '1']);
  expect(parse('nope')).toBe(null);
});

test('compare orders releases', () => {
  expect(compare('1.2.3', '1.10.0')).toBe(-1);
  expect(compare('2.0.0', '1.9.9')).toBe(1);
  expect(compare('1.0.0-alpha', '1.0.0')).toBe(-1);
  expect(compare('1.2.3', '1.2.3')).toBe(0);
});

test('satisfies common ranges', () => {
  expect(satisfies('1.4.0', '^1.2.3')).toBe(true);
  expect(satisfies('2.0.0', '^1.2.3')).toBe(false);
  expect(satisfies('1.2.9', '~1.2.3')).toBe(true);
  expect(satisfies('1.3.0', '~1.2.3')).toBe(false);
  expect(satisfies('3.1.0', '1.x || >=3.0.0')).toBe(true);
  expect(satisfies('1.5.0', '1.2.3 - 2.3.4')).toBe(true);
});

test('brokenDeps and maxSatisfying', () => {
  expect(brokenDeps({ a: '^1.0.0', b: '~2.1.0', c: '*' }, { a: '1.5.0', b: '2.2.0' })).toEqual([
    'b',
    'c',
  ]);
  expect(maxSatisfying(['1.0.0', '1.4.2', '2.0.0'], '^1.0.0')).toBe('1.4.2');
});
