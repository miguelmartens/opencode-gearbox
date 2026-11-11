import { expect, test } from 'bun:test';
import { findUserByEmail, findUserById } from './lookup.ts';
import { USERS } from './users.ts';

test('finds by id', () => {
  expect(findUserById(USERS, 3)?.name).toBe('Alan Turing');
  expect(findUserById(USERS, 99)).toBeUndefined();
});

test('finds by exact email', () => {
  expect(findUserByEmail(USERS, 'ada@example.com')?.id).toBe(1);
});
