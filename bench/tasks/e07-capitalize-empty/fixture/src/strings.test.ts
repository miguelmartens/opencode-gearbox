import { expect, test } from 'bun:test';
import { capitalize, titleCase } from './strings.ts';

test('capitalize', () => {
  expect(capitalize('hello')).toBe('Hello');
  expect(capitalize('hELLO')).toBe('HELLO');
});

test('titleCase', () => {
  expect(titleCase('the quick fox')).toBe('The Quick Fox');
});
