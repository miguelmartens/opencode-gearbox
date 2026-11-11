import { expect, test } from 'bun:test';
import { createUser, toDisplay } from './user.ts';
import { roster } from './team.ts';

test('createUser trims the name and assigns ids', () => {
  const a = createUser('  Ada ');
  const b = createUser('Bob');
  expect(a.name).toBe('Ada');
  expect(b.id).toBe(a.id + 1);
});

test('roster lists names in order', () => {
  expect(roster([createUser('Bob'), createUser('Ada')])).toBe('Ada\nBob');
  expect(toDisplay(createUser('Cy'))).toBe('Cy');
});
